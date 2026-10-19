import { createClient } from '@supabase/supabase-js';
export interface AssetStore { upload(key:string,bytes:Buffer):Promise<void>; read(key:string):Promise<Buffer>; remove(keys:string[]):Promise<void>; }
export function createAssetStore(url:string,serviceKey:string):AssetStore {
  const client=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const bucket=client.storage.from('project-assets');
  return {
    async upload(key,bytes){const {error}=await bucket.upload(key,bytes,{contentType:'application/octet-stream',upsert:false});if(error)throw new Error('Attachment upload failed');},
    async read(key){const {data,error}=await bucket.download(key);if(error||!data)throw new Error('Attachment download failed');return Buffer.from(await data.arrayBuffer());},
    async remove(keys){if(!keys.length)return;const {error}=await bucket.remove(keys);if(error)throw new Error('Attachment cleanup failed');}
  };
}
