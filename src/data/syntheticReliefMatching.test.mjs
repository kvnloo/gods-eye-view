import assert from 'node:assert/strict';
import test from 'node:test';
import { solveSyntheticReliefMatching, RELIEF_MATCHING_LIMITS } from './syntheticReliefMatching.js';

function fixture(resourceCount=2, requestCount=2) {
  const resources = Array.from({length:resourceCount},(_,i)=>({id:`resource-${i}`}));
  const requests = Array.from({length:requestCount},(_,i)=>({id:`request-${i}`}));
  const edges = resources.flatMap(r=>requests.map(q=>({
    resourceId:r.id, requestId:q.id, status:'supported', evidenceRef:'synthetic:edge-r1',
  })));
  return { studyId:'simulated-idai', determination:'hypothetical', datasetKind:'synthetic',
    sourceRef:'synthetic:benchmark-s1', worldRevision:'world-r1', resourceRevision:'stock-r1',
    requestRevision:'needs-r1', accessRevision:'access-r1', policyRevision:'policy-r1',
    resources, requests, edges };
}
const solve=(changes={})=>solveSyntheticReliefMatching({...fixture(),...changes});
const setEdge=(input,r,q,status)=>({...input,edges:input.edges.map(e=>e.resourceId===r&&e.requestId===q?{...e,status}:e)});

function independentMax(resources,requests,edges,includeUnknown=false){
  let best=0;
  const permitted=new Set(edges.filter(e=>e.status==='supported'||(includeUnknown&&e.status==='unknown'))
    .map(e=>`${e.resourceId}\0${e.requestId}`));
  function enumerate(i,used,count){
    if(i===resources.length){best=Math.max(best,count);return;}
    enumerate(i+1,used,count);
    for(let j=0;j<requests.length;j++){
      if(!used.has(j)&&permitted.has(`${resources[i].id}\0${requests[j].id}`)){
        used.add(j);enumerate(i+1,used,count+1);used.delete(j);
      }
    }
  }
  enumerate(0,new Set(),0);
  return best;
}

test('synthetic supported 2x2 matching is deterministic and one-to-one',()=>{
  const a=solve(); assert.equal(a.status,'evaluated');assert.equal(a.matchedCount,2);
  assert.equal(a.possibleMaximumIfUnknownUsable,2);
  assert.deepEqual(a.matchedPairs.map(x=>[x.resourceId,x.requestId]),
    [['resource-0','request-0'],['resource-1','request-1']]);
  assert.equal(a.authority,'none');assert.equal(a.accessClaim,'not-evaluated');
  assert.equal(a.determination,'hypothetical'); assert.ok(Object.isFrozen(a.matchedPairs));
});

test('injecting known unavailable access forces a different supported solution',()=>{
  let f=fixture();f=setEdge(f,'resource-0','request-0','unsupported');
  const a=solveSyntheticReliefMatching(f);
  assert.equal(a.matchedCount,2);
  assert.deepEqual(a.matchedPairs.map(x=>[x.resourceId,x.requestId]),
    [['resource-0','request-1'],['resource-1','request-0']]);
  f=setEdge(f,'resource-1','request-0','unsupported');
  const b=solveSyntheticReliefMatching(f);
  assert.equal(b.matchedCount,1);
  assert.equal(b.matchedPairs[0].resourceId,'resource-0');
});

test('unknown access is NOT selected, but upper bound exposes possible extra matches',()=>{
  let f=fixture(1,1);f=setEdge(f,'resource-0','request-0','unknown');
  const x=solveSyntheticReliefMatching(f);
  assert.equal(x.status,'limited');assert.equal(x.matchedCount,0);
  assert.equal(x.possibleMaximumIfUnknownUsable,1);
  assert.deepEqual(x.matchedPairs,[]);
});

test('missing edge is unknown rather than silently an excluded edge',()=>{
  const f=fixture();f.edges.pop();
  const result=solveSyntheticReliefMatching(f);
  assert.equal(result.status,'unknown');
  assert.equal(result.reason,'incomplete-edge-matrix');
  assert.equal('matchedCount' in result,false);
});

test('explicit unsupported edge can cause unmatched synthetic request',()=>{
  let f=fixture(1,2);f=setEdge(f,'resource-0','request-0','unsupported');
  const x=solveSyntheticReliefMatching(f);
  assert.deepEqual(x.unmatchedRequests,['request-0']);
  assert.equal(x.unknownEdges,0);assert.equal(x.excludedEdges,1);
});

test('world/access/policy revision is retained but never authorizes an action',()=>{
  const a=solve(), b=solve({accessRevision:'access-r2'});
  assert.equal(a.context.accessRevision,'access-r1');
  assert.notEqual(a.context.accessRevision,b.context.accessRevision);
  assert.equal(a.implementation,'not-authorized');
  assert.equal('dispatch' in a,false);
});

test('refuses real or authoritative data input',()=>{
  assert.throws(()=>solve({determination:'observed'}),/synthetic hypothetical/);
  assert.throws(()=>solve({datasetKind:'real'}),/synthetic hypothetical/);
  const x=solve({authority:'approved',implementation:'deployed'});
  assert.equal(x.authority,'none');assert.equal(x.implementation,'not-authorized');
});

test('duplicate/unknown endpoints, edge statuses and missing evidence are invalid',()=>{
  let f=fixture();f.edges.push({...f.edges[0]});
  assert.throws(()=>solveSyntheticReliefMatching(f),/duplicate edge/);
  f=fixture();f.edges[0].requestId='request-secret';
  assert.throws(()=>solveSyntheticReliefMatching(f),/endpoints/);
  f=fixture();f.edges[0].status='assume-open';
  assert.throws(()=>solveSyntheticReliefMatching(f),/status/);
  f=fixture();f.edges[0].evidenceRef='';
  assert.throws(()=>solveSyntheticReliefMatching(f),/evidenceRef/);
});

test('missing source/authority revision and duplicate node id fail',()=>{
  assert.throws(()=>solve({policyRevision:''}),/policyRevision/);
  assert.throws(()=>solve({sourceRef:''}),/sourceRef/);
  assert.throws(()=>solve({resources:[{id:'resource-0'},{id:'resource-0'}]}),/unique/);
  assert.throws(()=>solve({requests:[]}),/nonempty/);
});

test('bounded reference fails closed on oversized inputs',()=>{
  assert.equal(RELIEF_MATCHING_LIMITS.resources,8);
  assert.equal(solveSyntheticReliefMatching(fixture(9,2)).reason,'reference-size-limit');
  assert.equal(solveSyntheticReliefMatching(fixture(8,9)).reason,'reference-size-limit');
});

test('input remains untouched and stable under order/permutation',()=>{
  const f=fixture();const before=JSON.stringify(f);
  const a=solveSyntheticReliefMatching(f);
  assert.equal(JSON.stringify(f),before);
  const reverse={...f, resources:[...f.resources].reverse(), requests:[...f.requests].reverse(), edges:[...f.edges].reverse()};
  assert.deepEqual(a,solveSyntheticReliefMatching(reverse));
});

test('independent exhaustive cardinality oracle agrees across every 2x2 three-state matrix',()=>{
  const modes=['supported','unsupported','unknown'];
  for(let mask=0;mask<81;mask++){
    const f=fixture(2,2);let x=mask;
    for(let i=0;i<4;i++){f.edges[i].status=modes[x%3];x=Math.floor(x/3);}
    const result=solveSyntheticReliefMatching(f);
    assert.equal(result.matchedCount,independentMax(f.resources,f.requests,f.edges,false),mask);
    assert.equal(result.possibleMaximumIfUnknownUsable,independentMax(f.resources,f.requests,f.edges,true),mask);
    assert.ok(result.possibleMaximumIfUnknownUsable>=result.matchedCount);
  }
});

test('independent oracle agrees across randomized sparse 3x3 synthetic matrices',()=>{
  let seed=0x1234abcf;
  const roll=()=>{seed=(1664525*seed+1013904223)>>>0;return seed%3;};
  const modes=['supported','unsupported','unknown'];
  for(let round=0;round<100;round++){
    const f=fixture(3,3);
    for(const e of f.edges)e.status=modes[roll()];
    const result=solveSyntheticReliefMatching(f);
    assert.equal(result.matchedCount,independentMax(f.resources,f.requests,f.edges),round);
    assert.equal(result.possibleMaximumIfUnknownUsable,independentMax(f.resources,f.requests,f.edges,true),round);
  }
});
