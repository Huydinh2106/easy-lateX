// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountState, DesktopApi } from '@easy-latex/shared-types';
import { AccountPanel } from '../src/renderer/features/account/AccountPanel';

const anonymous: AccountState = {configured: true, account: null, googleEnabled: false, recovery: false, sessionPersistence: 'secure', apiUrl: 'https://api.example.test'};
const account = {id: 'alice', email: 'alice@example.test', displayName: 'Alice'};
const signedIn = {...anonymous, account};
afterEach(cleanup);
const fillCredentials = () => {
  fireEvent.change(screen.getByLabelText('Email'), {target: {value: account.email}});
  fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'my-password'}});
};

describe('Email account forms', () => {
  it('reports when the OS key store cannot retain the session', () => {
    render(<AccountPanel state={{...anonymous, sessionPersistence: 'memory'}} onChanged={() => {}}/>);
    expect(screen.getByRole('status')).toHaveTextContent('sign in again after closing');
  });

  it('lets an unconfigured packaged app save its server before signing in', async () => {
    const state = {...anonymous, configured: false};
    const next = {...state, configured: true, apiUrl: 'https://api.example.com'};
    const configure = vi.fn().mockResolvedValue(next), onChanged = vi.fn();
    window.desktop = {auth: {configure}} as unknown as DesktopApi;
    render(<AccountPanel state={state} onChanged={onChanged}/>);
    fireEvent.change(screen.getByLabelText('Collaboration server'), {target: {value: 'https://api.example.com'}});
    fireEvent.click(screen.getByRole('button', {name: 'Save server'}));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(next));
    expect(configure).toHaveBeenCalledWith('https://api.example.com');
  });

  it('signs in with email and password without a GitHub or browser step', async () => {
    const signIn = vi.fn().mockResolvedValue(signedIn), onChanged = vi.fn();
    window.desktop = {auth: {signIn}} as unknown as DesktopApi;
    render(<AccountPanel state={anonymous} onChanged={onChanged}/>);
    fillCredentials(); fireEvent.click(screen.getByRole('button', {name: 'Sign in'}));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(signedIn));
    expect(signIn).toHaveBeenCalledWith({email: account.email, password: 'my-password'});
    expect(screen.queryByText(/github/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('requires matching passwords and shows email confirmation after signup', async () => {
    const next = {...anonymous, confirmationRequired: true, message: 'Confirm your email before signing in.'};
    const signUp = vi.fn().mockResolvedValue(next), onChanged = vi.fn();
    window.desktop = {auth: {signUp}} as unknown as DesktopApi;
    render(<AccountPanel state={anonymous} onChanged={onChanged}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Create an account'}));
    fireEvent.change(screen.getByLabelText('Display name'), {target: {value: 'Alice'}});
    fillCredentials();
    fireEvent.change(screen.getByLabelText('Confirm password'), {target: {value: 'wrong-password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match'); expect(signUp).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Confirm password'), {target: {value: 'my-password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));
    expect(await screen.findByRole('status')).toHaveTextContent('Confirm your email');
    expect(signUp).toHaveBeenCalledWith({email: account.email, password: 'my-password', displayName: 'Alice'});
    expect(onChanged).toHaveBeenCalledWith(next); expect(screen.getByRole('button', {name: 'Sign in'})).toBeEnabled();
  });

  it('keeps sign-in retryable when the password is rejected', async () => {
    const signIn = vi.fn().mockRejectedValue(new Error('Invalid email or password'));
    window.desktop = {auth: {signIn}} as unknown as DesktopApi;
    render(<AccountPanel state={anonymous} onChanged={() => {}}/>);
    fillCredentials(); fireEvent.click(screen.getByRole('button', {name: 'Sign in'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.getByRole('button', {name: 'Sign in'})).toBeEnabled(); expect(screen.getByLabelText('Email')).toHaveValue(account.email);
  });

  it('follows a password reset email through to choosing a new password', async () => {
    const resetPassword = vi.fn().mockResolvedValue({...anonymous, recoveryPending: true, message: 'Follow the link in your email.'});
    const state = vi.fn().mockResolvedValue({...anonymous, account, recovery: true});
    const updatePassword = vi.fn().mockResolvedValue(signedIn), onChanged = vi.fn();
    window.desktop = {auth: {resetPassword, state, updatePassword}} as unknown as DesktopApi;
    render(<AccountPanel state={anonymous} onChanged={onChanged}/>);
    fireEvent.click(screen.getByRole('button', {name: 'Forgot password?'}));
    fireEvent.change(screen.getByLabelText('Email'), {target: {value: account.email}});
    fireEvent.click(screen.getByRole('button', {name: 'Send reset link'}));
    expect(await screen.findByText(/Keep Easy LaTeX open/)).toBeInTheDocument();
    expect(resetPassword).toHaveBeenCalledWith(account.email);
    const password = await screen.findByLabelText('New password', {}, {timeout: 2500});
    fireEvent.change(password, {target: {value: 'updated-password'}});
    fireEvent.change(screen.getByLabelText('Confirm password'), {target: {value: 'updated-password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Save new password'}));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(signedIn));
    expect(updatePassword).toHaveBeenCalledWith('updated-password');
  });
});
