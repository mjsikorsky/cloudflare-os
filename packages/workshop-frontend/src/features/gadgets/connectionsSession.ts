import {RpcTarget} from 'capnweb'

/** Parent-owned navigation only; connection grants still use the existing Connections UI. */
export class GadgetConnectionsSession extends RpcTarget {
  constructor(private readonly readAdmission:()=>Promise<'workspace'|'key'>,private readonly current:()=>boolean,private readonly openConnections:()=>boolean){super()}
  async open():Promise<{status:'available';value:{opened:true}}|{status:'unavailable';reason:string}>{
    if(!this.current())return{status:'unavailable',reason:'This gadget session has ended.'}
    try{await this.readAdmission()}catch{return{status:'unavailable',reason:'This gadget session is no longer admitted.'}}
    if(!this.current())return{status:'unavailable',reason:'This gadget session has ended.'}
    return this.openConnections()?{status:'available',value:{opened:true}}:{status:'unavailable',reason:'Connection management is not available in this view.'}
  }
}
