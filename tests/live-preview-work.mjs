import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {morphPreviewWorkChecks} from './morph-preview-work.mjs';
import {gizmoRegressionChecks} from './gizmo-query-work.mjs';

function replaceBlock(html,start,next,replacement){
  const a=html.indexOf(start),b=html.indexOf(next,a+start.length);
  if(a<0||b<=a||html.indexOf(start,a+start.length)>=0)throw Error('Native source region missing or ambiguous: '+start);
  return html.slice(0,a)+replacement+html.slice(b);
}
export function reconstructLegacySource(current,morph,gizmo){
  if(!morph.sourceIndexSHA256||morph.sourceIndexSHA256!==gizmo.sourceIndexSHA256)throw Error('Legacy source provenance mismatch');
  let legacy=replaceBlock(current,'function previewEdit(','function afterEdit(',morph.previewEdit+'\n  ');
  legacy=replaceBlock(legacy,'function preview(n,segments,vertices=[])','function tangentBase(',morph.splinePreview+'\n  ');
  const needle='FrameMorph.previewEdit(t.morph.n,',call=legacy.indexOf(needle),start=legacy.lastIndexOf('if(t.morph){',call),end=legacy.indexOf('new Float32Array(data)',call);
  if(call<0||start<0||end<=call||legacy.indexOf(needle,call+needle.length)>=0)throw Error('Native polygon Morph caller missing or ambiguous');
  legacy=legacy.slice(0,start)+morph.polygonTransformBranch+legacy.slice(end);
  return replaceBlock(legacy,'function drawGizmo(','function pointerWorld(',gizmo.drawGizmo+'\n    ');
}
export async function livePreviewWorkChecks(){
  const [html,morphText,gizmoText]=await Promise.all([
    readFile(new URL('../index.html',import.meta.url),'utf8'),
    readFile(new URL('./fixtures/morph-preview-legacy.json',import.meta.url),'utf8'),
    readFile(new URL('./fixtures/gizmo-query-legacy.json',import.meta.url),'utf8'),
  ]);
  const legacy=reconstructLegacySource(html,JSON.parse(morphText),JSON.parse(gizmoText));
  const morph=await morphPreviewWorkChecks(html,legacy),gizmo=await gizmoRegressionChecks(legacy,html);
  return {pass:morph.pass&&gizmo.pass,checks:[...morph.checks,...gizmo.checks],indexSHA256:createHash('sha256').update(html).digest('hex'),workcounts:{morph:morph.workcounts,gizmo:gizmo.workcounts??gizmo.largeWork}};
}
