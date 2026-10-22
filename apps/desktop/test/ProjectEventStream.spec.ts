import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectUpdateEvent } from '@easy-latex/shared-types';
import { ProjectEventStream } from '../src/main/services/collaboration/ProjectEventStream';

afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
describe('Authenticated project update stream',()=>{
  it('decodes split SSE frames, filters other projects, and aborts on unsubscribe',async()=>{
    let controller!:ReadableStreamDefaultController<Uint8Array>;
    const body=new ReadableStream<Uint8Array>({start:value=>{controller=value;}});
    const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(body,{headers:{'Content-Type':'text/event-stream'}}));
    const notify=vi.fn<(event:ProjectUpdateEvent)=>void>();const stream=new ProjectEventStream('http://127.0.0.1:4318','project',()=>Promise.resolve('private-token'),notify);
    const running=stream.run();await tick();
    const encoder=new TextEncoder();
    controller.enqueue(encoder.encode('event: ready\r\ndata: {"projectId":"project"}\r\n\r'));
    controller.enqueue(encoder.encode('\nevent: changed\ndata: {"projectId":"other"}\n\nevent: changed\ndata: {"projectId":"project"}\n\n'));
    await tick();
    expect(notify.mock.calls.map(([event])=>event)).toEqual([{projectId:'project',type:'connected'},{projectId:'project',type:'changed'}]);
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:4318/projects/project/events',expect.objectContaining({headers:{Authorization:'Bearer private-token',Accept:'text/event-stream'}}));
    stream.stop();controller.close();await running;
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it('reconnects with a refreshed token and reports readiness for snapshot recovery',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    const notify=vi.fn();const tokens=vi.fn().mockResolvedValueOnce('old-token').mockResolvedValue('new-token');
    let controller!:ReadableStreamDefaultController<Uint8Array>;
    const second=new ReadableStream<Uint8Array>({start:value=>{controller=value;}});
    const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(new Response(second,{headers:{'Content-Type':'text/event-stream'}}));
    const stream=new ProjectEventStream('http://127.0.0.1:4318','project',tokens,notify);
    const running=stream.run();await vi.advanceTimersByTimeAsync(0);
    expect(notify).toHaveBeenCalledWith({projectId:'project',type:'disconnected'});
    await vi.advanceTimersByTimeAsync(1000);
    controller.enqueue(new TextEncoder().encode('event: ready\ndata: {"projectId":"project"}\n\n'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher.mock.calls[1]![1]!.headers).toEqual({Authorization:'Bearer new-token',Accept:'text/event-stream'});
    expect(notify).toHaveBeenLastCalledWith({projectId:'project',type:'connected'});
    stream.stop();controller.close();await running;
    await vi.advanceTimersByTimeAsync(60_000);expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
