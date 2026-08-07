#!/usr/bin/env python3
"""Independent P1 FEM reference for two parallel round conductors.

This validation program intentionally does not share the browser solver's mesh,
linear algebra, or TypeScript implementation.  It uses Triangle for the PSLG
mesh and SciPy's sparse direct solver.  Coordinates are normalized by radius.
"""
from __future__ import annotations
import argparse, json, math
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla
from scipy.special import jv
import triangle as tr

MU0 = 4e-7 * math.pi

def make_mesh(g_norm: float, outer: float, nb: int, ac: float, aa: float):
    pts, seg = [], []
    def loop(xy):
        start = len(pts); pts.extend(xy); n = len(xy)
        seg.extend((start+i, start+(i+1)%n) for i in range(n))
    loop([(-outer,-outer),(outer,-outer),(outer,outer),(-outer,outer)])
    d = 2 + g_norm
    for cx in (-d/2, d/2):
        loop([(cx+math.cos(2*math.pi*i/nb), math.sin(2*math.pi*i/nb)) for i in range(nb)])
    # attribute 0=air, 1=A, 2=B; fourth column is regional max triangle area.
    regions = [[0, outer*.75, 0, aa], [-d/2, 0, 1, ac], [d/2, 0, 2, ac]]
    out = tr.triangulate({"vertices":np.array(pts), "segments":np.array(seg), "regions":np.array(regions)}, "pq30aA")
    return out["vertices"], out["triangles"], out["triangle_attributes"][:,0].astype(int)

def solve(f_hz=1e4, diameter_mm=3, gap_mm=.01, sigma=5.8e7, current=1.0,
          outer=20, boundary=256, area_cond=.0012, area_air=.18):
    a = diameter_mm*5e-4
    omega = 2*math.pi*f_hz
    eta = omega*MU0*sigma*a*a
    p,t,mat = make_mesh(gap_mm*1e-3/a, outer, boundary, area_cond, area_air)
    outer_node = (np.isclose(abs(p[:,0]),outer,atol=1e-10) | np.isclose(abs(p[:,1]),outer,atol=1e-10))
    free = np.flatnonzero(~outer_node); rev = np.full(len(p),-1,int); rev[free]=np.arange(len(free))
    n=len(free); K=sp.lil_matrix((n,n),dtype=float); M=sp.lil_matrix((n,n),dtype=float)
    b=[np.zeros(n),np.zeros(n)]; S=np.zeros(2)
    for q,tri in enumerate(t):
        xy=p[tri]; cross=np.cross(xy[1]-xy[0],xy[2]-xy[0]); A=abs(cross)/2
        bv=np.array([xy[1,1]-xy[2,1],xy[2,1]-xy[0,1],xy[0,1]-xy[1,1]])
        cv=np.array([xy[2,0]-xy[1,0],xy[0,0]-xy[2,0],xy[1,0]-xy[0,0]])
        m=mat[q]-1 if mat[q] in (1,2) else -1
        if m>=0:S[m]+=A
        for i in range(3):
            ui=rev[tri[i]]
            if ui<0:continue
            if m>=0:b[m][ui]+=A/3
            for j in range(3):
                uj=rev[tri[j]]
                if uj<0:continue
                K[ui,uj]+=(bv[i]*bv[j]+cv[i]*cv[j])/(4*A)
                if m>=0:M[ui,uj]+=A*(2 if i==j else 1)/12
    # Scale C as q_k = μ σ a² C_k. This gives a well-scaled augmented system:
    # (K+jηM)A - b q = 0;  -jη bᵀA + S q = μ I.
    K=K.tocsr(); M=M.tocsr(); z=sp.csr_matrix((1,1),dtype=complex)
    bc=[sp.csr_matrix(x[:,None]) for x in b]
    Aaug=sp.bmat([[K+1j*eta*M,-bc[0],-bc[1]],
                  [-1j*eta*bc[0].T,sp.csr_matrix([[S[0]]]),z],
                  [-1j*eta*bc[1].T,z,sp.csr_matrix([[S[1]]])]],format="csc")
    rhs=np.zeros(n+2,complex); rhs[-2:]=MU0*np.array([current,-current])
    x=spla.spsolve(Aaug,rhs); az=np.zeros(len(p),complex); az[free]=x[:n]
    C=x[n:]/(MU0*sigma*a*a)
    loss=0.; currents=np.zeros(2,complex); ploss=np.zeros(2)
    gp=np.array([[2/3,1/6,1/6],[1/6,2/3,1/6],[1/6,1/6,2/3]])
    for q,tri in enumerate(t):
        m=mat[q]-1 if mat[q] in (1,2) else -1
        if m<0:continue
        xy=p[tri]; area=abs(np.cross(xy[1]-xy[0],xy[2]-xy[0]))/2*a*a
        for w in gp:
            aq=w@az[tri]; J=sigma*(C[m]-1j*omega*aq); ds=area/3
            ploss[m]+=abs(J)**2/sigma*ds; loss+=abs(J)**2/sigma*ds; currents[m]+=J*ds
    rdc=2/(sigma*math.pi*a*a)
    residual=max(abs(currents[0]-current),abs(currents[1]+current))/abs(current)
    return {"Rdc_ohm_m":rdc,"Rac_ohm_m":loss/current**2,"ratio":loss/current**2/rdc,
            "loss_A_W_m":ploss[0],"loss_B_W_m":ploss[1],"current_residual":residual,
            "nodes":len(p),"triangles":len(t),"outer_factor":outer}

def bessel_resistance(f_hz, diameter_mm, sigma=5.8e7):
    a=diameter_mm*5e-4; k=np.sqrt(-1j*2*math.pi*f_hz*MU0*sigma)
    return float(np.real(k*jv(0,k*a)/(2*math.pi*a*sigma*jv(1,k*a))))

if __name__ == "__main__":
    ap=argparse.ArgumentParser(); ap.add_argument("--frequency",type=float,default=1e4); ap.add_argument("--diameter",type=float,default=3); ap.add_argument("--gap",type=float,default=.01); ap.add_argument("--outer",type=float,default=20); ap.add_argument("--boundary",type=int,default=256)
    ns=ap.parse_args(); print(json.dumps(solve(ns.frequency,ns.diameter,ns.gap,outer=ns.outer,boundary=ns.boundary),indent=2))
