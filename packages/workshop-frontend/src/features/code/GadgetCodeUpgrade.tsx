import {useEffect,useRef,useState} from 'react'
import type {RpcStub} from 'capnweb'
import type {GadgetUpgradePreview,Overseer,WorkpieceId} from '@gadgets/workshop-shared/api'
import {useAuthenticatedApi} from '../../AuthContext'
import {WorkshopButton} from '../../components/WorkshopControls'

export function GadgetCodeUpgrade({overseer,gadgetId,ready,hasChat,onReviewChat,onStage}:{overseer:RpcStub<Overseer>;gadgetId:WorkpieceId;ready:boolean;hasChat:boolean;onReviewChat(id:number):void;onStage(candidate:GadgetUpgradePreview):void}){
 const {authenticatedApi}=useAuthenticatedApi()
 const [choices,setChoices]=useState<Array<{id:string;title:string}>>([])
 const [open,setOpen]=useState(false),[blueprint,setBlueprint]=useState(''),[candidate,setCandidate]=useState<GadgetUpgradePreview|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[confirmed,setConfirmed]=useState(false),[stageAfterOpen,setStageAfterOpen]=useState(false)
 const scope=useRef(gadgetId);scope.current=gadgetId
 useEffect(()=>{if(!open)return;let active=true;void Promise.all([authenticatedApi.listLibraryBlueprints(),authenticatedApi.listOutputFormats()]).then(([library,formats])=>{if(!active)return;const options=new Map(library.map(item=>[item.id,{id:item.id,title:item.metadata.title}]));for(const format of formats)if(!options.has(format.blueprintId))options.set(format.blueprintId,{id:format.blueprintId,title:format.output.noun});setChoices([...options.values()])}).catch(()=>{if(active)setMessage('The library list is unavailable. You can still select an archive or enter a blueprint ID.')});return()=>{active=false}},[open,authenticatedApi])
 useEffect(()=>{setCandidate(null);setConfirmed(false);setStageAfterOpen(false);setMessage('')},[gadgetId])
 const stage=()=>{if(!candidate)return;try{onStage(candidate);setStageAfterOpen(false);setCandidate(null);setMessage('Code staged in this conversation. Review the Changes and choose Accept to activate it.')}catch(error){setStageAfterOpen(false);setMessage(error instanceof Error?error.message:String(error))}}
 useEffect(()=>{if(stageAfterOpen&&ready)stage()},[stageAfterOpen,ready])
 async function preview(source:Parameters<Overseer['previewGadgetUpgrade']>[1]){const own=gadgetId;setBusy(true);setMessage('');setCandidate(null);setConfirmed(false);try{const value=await overseer.previewGadgetUpgrade(own,source);if(scope.current===own)setCandidate(value)}catch(error){if(scope.current===own)setMessage(error instanceof Error?error.message:String(error))}finally{if(scope.current===own)setBusy(false)}}
 async function review(){if(hasChat){stage();return}setBusy(true);try{const chat=await overseer.newChat('Review code upgrade for this gadget.',null);setStageAfterOpen(true);onReviewChat(chat)}catch(error){setMessage(error instanceof Error?error.message:String(error))}finally{setBusy(false)}}
 return <div className="border-b border-kumo-line bg-kumo-base px-3 py-2 text-sm">
  <WorkshopButton tone="secondary" onClick={()=>setOpen(!open)}>Import / upgrade code</WorkshopButton>
  {open&&<div className="mt-3 space-y-3">
   <p>Replace this gadget’s code through a reviewed conversation. Its identity, stored data, access policy and existing Connections are retained. Review data migrations in the imported code before accepting.</p>
   <label className="block">Gadget archive <input type="file" accept=".gadget" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void preview({type:'archive',archive:file.stream()})}}/></label>
   <div className="flex flex-wrap gap-2"><label>Library or standard gadget <select className="rounded border border-kumo-line bg-kumo-base px-2 py-1" value={blueprint} onChange={event=>setBlueprint(event.target.value)}><option value="">Choose a blueprint</option>{choices.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>Blueprint ID <input className="rounded border border-kumo-line bg-kumo-base px-2 py-1" value={blueprint} onChange={event=>setBlueprint(event.target.value)}/></label><WorkshopButton tone="secondary" disabled={busy||!blueprint.trim()} onClick={()=>void preview({type:'blueprint',blueprintId:blueprint.trim()})}>Preview latest published revision</WorkshopButton></div>
   {candidate&&<div className="space-y-2"><p>{candidate.title} · version {candidate.version} · {candidate.files.length} files</p><p className="break-all">Content SHA-256: {candidate.contentSha256}</p><p>Expected Connections: {candidate.requiredBindings.join(', ')||'None'}. Connections are not added or replaced by this import.</p><details><summary>Review imported files</summary><ul className="max-h-48 overflow-auto">{candidate.files.map(([path,text])=><li key={path}>{path} · {text.length.toLocaleString()} characters</li>)}</ul></details><label className="block"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/> Stage this complete replacement, including removal of files absent from the archive.</label><WorkshopButton tone="primary" disabled={busy||!confirmed||(hasChat&&!ready)} onClick={()=>void review()}>{hasChat?'Stage upgrade for review':'Create upgrade review'}</WorkshopButton></div>}
   {busy&&<p role="status">Preparing code upgrade…</p>}{message&&<p role="status">{message}</p>}
  </div>}
 </div>
}
