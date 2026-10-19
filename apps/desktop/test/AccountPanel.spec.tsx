// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopApi } from '@easy-latex/shared-types';
import { AccountPanel } from '../src/renderer/features/account/AccountPanel';

afterEach(cleanup);
describe('collaboration connection setup',()=>{
  it('reports when the OS key store cannot retain the session',()=>{
    render(<AccountPanel state={{configured:true,account:null,googleEnabled:false,recovery:false,sessionPersistence:'memory'}} onChanged={()=>{}}/>);
    expect(screen.getByRole('status').textContent).toContain('sign in again after closing');
  });
  it('lets an unconfigured packaged app save its server before signing in',async()=>{
    const state={configured:false,account:null,googleEnabled:false,recovery:false};
    const next={...state,configured:true,apiUrl:'https://api.example.com'};
    const configure=vi.fn().mockResolvedValue(next),onChanged=vi.fn();
    window.desktop={auth:{configure}} as unknown as DesktopApi;
    render(<AccountPanel state={state} onChanged={onChanged}/>);
    fireEvent.change(screen.getByLabelText('Collaboration server'),{target:{value:'https://api.example.com'}});
    fireEvent.click(screen.getByRole('button',{name:'Save server'}));
    await waitFor(()=>expect(onChanged).toHaveBeenCalledWith(next));
    expect(configure).toHaveBeenCalledWith('https://api.example.com');
  });
  it('shows browser handoff progress and returns to a retryable sign-in after cancellation',async()=>{
    let reject:(error:Error)=>void=()=>{};
    const github=vi.fn(()=>new Promise<never>((_resolve,fail)=>{reject=fail;}));
    const cancel=vi.fn(()=>{reject(new Error('Sign-in cancelled'));return Promise.resolve();});
    window.desktop={auth:{github,cancel}} as unknown as DesktopApi;
    render(<AccountPanel state={{configured:true,account:null,googleEnabled:false,recovery:false,sessionPersistence:'secure'}} onChanged={()=>{}}/>);
    fireEvent.click(screen.getByRole('button',{name:'Continue with GitHub'}));
    expect(screen.getByRole('button',{name:'Waiting for GitHub…'})).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Complete sign-in in your browser');
    fireEvent.click(screen.getByRole('button',{name:'Cancel sign-in'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in cancelled');
    expect(screen.getByRole('button',{name:'Continue with GitHub'})).toBeEnabled();
    expect(github).toHaveBeenCalledOnce();
  });
});
