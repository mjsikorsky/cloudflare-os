import {RpcTarget} from 'capnweb'

/** Parent-owned navigation only; connection grants still use the existing Connections UI. */
export class GadgetConnectionsSession extends RpcTarget {
  readonly #readAdmission:()=>Promise<'workspace'|'key'>
  readonly #current:()=>boolean
  readonly #openConnections:()=>boolean
  constructor(readAdmission:()=>Promise<'workspace'|'key'>,current:()=>boolean,openConnections:()=>boolean){super();this.#readAdmission=readAdmission;this.#current=current;this.#openConnections=openConnections}
  async open():Promise<{status:'available';value:{opened:true}}|{status:'unavailable';reason:string}>{
    if(!this.#current())return{status:'unavailable',reason:'This gadget session has ended.'}
    try{await this.#readAdmission()}catch{return{status:'unavailable',reason:'This gadget session is no longer admitted.'}}
    if(!this.#current())return{status:'unavailable',reason:'This gadget session has ended.'}
    return this.#openConnections()?{status:'available',value:{opened:true}}:{status:'unavailable',reason:'Connection management is not available in this view.'}
  }
}
