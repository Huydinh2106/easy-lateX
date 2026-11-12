// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvitationDialog } from '../src/renderer/features/collaboration/InvitationDialog';
import { AccountDialog } from '../src/renderer/features/account/AccountDialog';

afterEach(cleanup);
describe('collaboration dialog flows', () => {
  it('keeps invitation errors in the dialog and prevents closing during submission', async () => {
    let fail: (error: Error) => void = () => {};
    const invite = vi.fn(() => new Promise<void>((_resolve,reject) => { fail = reject; }));
    const close = vi.fn();
    render(<InvitationDialog projectName="Paper" onInvite={invite} onClose={close}/>);
    expect(document.activeElement).toBe(screen.getByLabelText('Email address'));
    expect(screen.getByLabelText('Email address')).toHaveAttribute('type','email');
    fireEvent.change(screen.getByLabelText('Email address'), {target: {value: 'Alice@example.com'}});
    fireEvent.click(screen.getByRole('button', {name: 'Add invitation'}));
    expect(invite).toHaveBeenCalledWith('alice@example.com','editor');
    fireEvent.keyDown(screen.getByRole('dialog'), {key: 'Escape'});
    expect(close).not.toHaveBeenCalled();
    fail(new Error('Cloud service is temporarily unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cloud service is temporarily unavailable');
    expect(screen.getByRole('button', {name: 'Add invitation'})).toBeEnabled();
    expect(screen.getByText(/accept the invitation from Projects/)).toBeInTheDocument();
  });

  it('invites a view-only member using their email without granting editor access', async () => {
    const invite=vi.fn().mockResolvedValue(undefined);
    render(<InvitationDialog projectName="Paper" onInvite={invite} onClose={()=>{}}/>);
    fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'reader@example.com'}});
    fireEvent.change(screen.getByLabelText('Permission'),{target:{value:'viewer'}});
    expect(screen.getByText('Read and compile project files without changing them.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Add invitation'}));
    await waitFor(()=>expect(invite).toHaveBeenCalledExactlyOnceWith('reader@example.com','viewer'));
  });

  it('rejects an invalid email address before creating an invitation', () => {
    const invite=vi.fn();
    render(<InvitationDialog projectName="Paper" onInvite={invite} onClose={()=>{}}/>);
    fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'reader-without-an-email'}});
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(screen.getByLabelText('Email address')).toBeInvalid();
    expect(invite).not.toHaveBeenCalled();
  });

  it('keeps keyboard focus inside the compact sign-in dialog', () => {
    render(<AccountDialog state={{configured: true,apiUrl: 'https://api.example.com',account: null,googleEnabled: false,recovery: false,sessionPersistence: 'secure'}} onChanged={() => {}} onClose={() => {}}/>);
    const close = screen.getByRole('button', {name: 'Close sign-in'});
    close.focus();
    fireEvent.keyDown(close, {key: 'Tab',shiftKey: true});
    expect(document.activeElement).toBe(screen.getByRole('button', {name: 'Forgot password?'}));
    fireEvent.keyDown(document.activeElement!, {key: 'Tab'});
    expect(document.activeElement).toBe(close);
  });
});
