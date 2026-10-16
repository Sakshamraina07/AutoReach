import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog, Drawer } from '../components/ui';
import type * as ApiModule from '../lib/api';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof ApiModule>()), api: apiMock }));

const { default: GmailCallback } = await import('../pages/GmailCallback');

function Where() {
  const l = useLocation();
  return <p>at {l.pathname + l.search}</p>;
}

function renderCallback(query: string) {
  window.history.replaceState(null, '', `/gmail/callback?${query}`);
  return render(
    <MemoryRouter initialEntries={['/gmail/callback']}>
      <Routes>
        <Route path="/gmail/callback" element={<GmailCallback />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Gmail connection callback page', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('finishes the connection as the signed-in user and returns to where it started', async () => {
    apiMock.mockResolvedValue({ email: 'student@example.dev', return_to: 'onboarding' });
    renderCallback('gmail_code=abc&state=st-1&return_to=onboarding');
    expect(await screen.findByText('at /onboarding?gmail=connected')).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/api/integrations/gmail/complete', { method: 'POST', body: { code: 'abc', state: 'st-1' } });
    // the code doesn't stay in the address bar
    expect(window.location.search).toBe('');
  });

  it('explains a declined consent without calling the API', async () => {
    renderCallback('gmail_error=access_denied&state=st-1&return_to=dashboard');
    expect(await screen.findByText(/access was declined/)).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
    expect(await screen.findByText('at /settings?section=gmail')).toBeInTheDocument();
  });

  it('shows the API’s reason when completing fails', async () => {
    apiMock.mockRejectedValue(new Error('This Gmail connection link has expired or was already used.'));
    renderCallback('gmail_code=abc&state=st-2');
    expect(await screen.findByText(/expired or was already used/)).toBeInTheDocument();
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
  });
});

describe('stacked overlays', () => {
  function Stack() {
    const [drawer, setDrawer] = useState(true);
    const [dialog, setDialog] = useState(true);
    return (
      <>
        {drawer && (
          <Drawer title="Recruiter" onClose={() => setDrawer(false)}>
            <p>drawer body</p>
          </Drawer>
        )}
        {dialog && (
          <Dialog title="Edit recruiter" onClose={() => setDialog(false)}>
            <p>dialog body</p>
          </Dialog>
        )}
      </>
    );
  }

  it('closes only the innermost one on Escape', () => {
    render(<Stack />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('dialog body')).toBeNull();
    expect(screen.getByText('drawer body')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('drawer body')).toBeNull();
  });
});
