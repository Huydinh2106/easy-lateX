// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopApi } from '@easy-latex/shared-types';
import { InvitationDialog } from '../src/renderer/features/collaboration/InvitationDialog';
import { LegacyMigrationPanel } from '../src/renderer/features/account/LegacyMigrationPanel';
import { AccountDialog } from '../src/renderer/features/account/AccountDialog';

afterEach(cleanup);
describe('collaboration dialog flows', () => {
  it('keeps invitation errors in the dialog and prevents closing during submission', async () => {
    let fail: (error: Error) => void = () => {};
    const invite = vi.fn(() => new Promise<void>((_resolve,reject) => { fail = reject; }));
    const close = vi.fn();
    render(<InvitationDialog projectName="Paper" onInvite={invite} onClose={close}/>);
    expect(document.activeElement).toBe(screen.getByLabelText('GitHub username'));
    fireEvent.change(screen.getByLabelText('GitHub username'), {target: {value: 'alice'}});
    fireEvent.click(screen.getByRole('button', {name: 'Add invitation'}));
    expect(invite).toHaveBeenCalledWith('alice');
    fireEvent.keyDown(screen.getByRole('dialog'), {key: 'Escape'});
    expect(close).not.toHaveBeenCalled();
    fail(new Error('GitHub is temporarily unavailable'));
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub is temporarily unavailable');
    expect(screen.getByRole('button', {name: 'Add invitation'})).toBeEnabled();
    expect(screen.getByText(/including outside Easy LaTeX/)).toBeInTheDocument();
  });

  it('requires ownership verification and project review before requesting migration', async () => {
    const migrate = vi.fn().mockResolvedValue({project: {id: 'new',name: 'Paper',role: 'owner'},limitations: 'History preserved as archives.'});
    const link = vi.fn().mockResolvedValue(undefined);
    const confirmation = vi.fn().mockResolvedValue(undefined);
    const migrated = vi.fn();
    window.desktop = {collaboration: {legacyConfirmation: confirmation,linkLegacy: link,legacyProjects: vi.fn().mockResolvedValue([{id: 'old',name: 'Paper',role: 'owner'}]),migrateLegacy: migrate}} as unknown as DesktopApi;
    render(<LegacyMigrationPanel onClose={() => {}} onMigrated={migrated}/>);
    fireEvent.change(screen.getByLabelText('Legacy account email'), {target: {value: 'owner@example.com'}});
    fireEvent.click(screen.getByRole('button', {name: 'Send confirmation code'}));
    fireEvent.change(await screen.findByLabelText('Ownership confirmation code'), {target: {value: '123456'}});
    fireEvent.click(screen.getByRole('button', {name: 'Confirm account link'}));
    const project = await screen.findByRole('button', {name: /Paper/});
    expect(link).toHaveBeenCalledWith('owner@example.com','123456');
    fireEvent.click(project);
    expect(migrate).not.toHaveBeenCalled();
    expect(screen.getByText(/private GitHub repository will be created/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Migrate project'}));
    await waitFor(() => expect(migrated).toHaveBeenCalledOnce());
    expect(migrate).toHaveBeenCalledExactlyOnceWith('old');
    expect(screen.getByRole('button', {name: /Paper, migrated/})).toBeDisabled();
  });

  it('cycles account focus through the connection summary while its inputs are collapsed', () => {
    render(<AccountDialog state={{configured: true,apiUrl: 'https://api.example.com',account: null,googleEnabled: false,recovery: false,sessionPersistence: 'secure'}} onChanged={() => {}} onClose={() => {}}/>);
    const close = screen.getByRole('button', {name: 'Close sign-in'});
    close.focus();
    fireEvent.keyDown(close, {key: 'Tab',shiftKey: true});
    expect(document.activeElement?.tagName).toBe('SUMMARY');
    fireEvent.keyDown(document.activeElement!, {key: 'Tab'});
    expect(document.activeElement).toBe(close);
  });
});
