import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const requireRuntime=createRequire(import.meta.resolve('wrangler/package.json'));
const {Miniflare}=requireRuntime('miniflare');
const requireBuild=createRequire(path.join(here,'../../workshop-backend/package.json'));
const {build}=requireBuild('esbuild');

test('native SQLite rollback discards notifications; committed delivery preserves indexes and nested order',async()=>{
  const bundled=await build({stdin:{contents:`
    import {DurableObject} from 'cloudflare:workers';
    import {createTypedStorage,collection} from ${JSON.stringify(path.join(here,'../src/index.ts'))};
    export class Probe extends DurableObject {
      async fetch(){
        const db=createTypedStorage(this.ctx.storage,{singletons:{version:0},collections:{
          rows:collection()({primaryKey:'id',uniqueIndexes:{byName:r=>r.name}}),
          unobserved:collection()({primaryKey:'id'}),
        }});
        const events=[];
        db.rows.subscribe({add:r=>events.push('add:'+r.id+':'+r.name),update:(a,b)=>events.push('update:'+b.name),remove:r=>events.push('remove:'+r.id)});
        db.version.subscribe({update:v=>events.push('version:'+v)});
        try{db.collectTransaction(()=>{db.rows.put({id:'lost',name:'lost'});db.version.put(9);throw Error('rollback');});}catch{}
        const rolledBack={events:[...events],row:db.rows.get('lost')??null,index:db.rows.byName.get('lost')??null,version:db.version.get()};
        const committed=db.collectTransaction(()=>{
          const row={id:'a',name:'one'};db.rows.put(row);row.name='mutated-after-write';
          try{db.collectTransaction(()=>{db.rows.put({id:'b',name:'two'});db.rows.put({id:'duplicate',name:'one'});});}catch{}
          db.transaction(()=>{db.rows.put({id:'c',name:'three'});db.version.put(1);});
          db.unobserved.put({id:'silent'});
          return 42;
        });
        const before=[...events];
        await this.ctx.storage.sync();committed.deliver();committed.deliver();
        return Response.json({rolledBack,before,after:events,value:committed.value,changes:committed.changes,
          a:db.rows.byName.get('one'),b:db.rows.get('b')??null,two:db.rows.byName.get('two')??null,c:db.rows.byName.get('three')});
      }
    }
    export default {fetch(r,e){return e.PROBE.get(e.PROBE.idFromName('one')).fetch(r)}};
  `,loader:'ts',resolveDir:here},bundle:true,format:'esm',platform:'neutral',external:['cloudflare:workers'],write:false});
  const mf=new Miniflare({modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-02-02',durableObjects:{PROBE:{className:'Probe',useSQLite:true}}});
  try{
    const response=await mf.dispatchFetch('https://native.invalid/');assert.equal(response.status,200);
    const value=await response.json();
    assert.deepEqual(value.rolledBack,{events:[],row:null,index:null,version:0});
    assert.deepEqual(value.before,[]);
    assert.deepEqual(value.after,['add:a:one','add:c:three','version:1']);
    assert.equal(value.value,42);assert.equal(value.b,null);assert.equal(value.two,null);
    assert.equal(value.a.id,'a');assert.equal(value.c.id,'c');
    assert.deepEqual(value.changes,[{name:'rows',key:'a',kind:'add'},{name:'rows',key:'c',kind:'add'},
      {name:'version',kind:'singleton'},{name:'unobserved',key:'silent',kind:'add'}]);
  }finally{await mf.dispose();}
});
