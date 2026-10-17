import type { PeopleSearch } from '@autoreach/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../lib/api';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof ApiModule>()), api: apiMock }));
const { FindPeople } = await import('../components/FindPeople');

const JOB = '11111111-1111-4111-8111-111111111111';
const found: PeopleSearch = {
  domain: 'northwind.example',
  limit: 10,
  people: [
    { email: 'priya.nair@northwind.example', first_name: 'Priya', last_name: 'Nair', position: 'Campus Recruiter', department: 'hr', seniority: null, confidence: 94, hunter_status: 'valid', linkedin: null, source_url: 'https://northwind.example/team', sources: 1, recruiter_id: null },
    { email: 'omar@northwind.example', first_name: 'Omar', last_name: null, position: null, department: 'hr', seniority: null, confidence: 60, hunter_status: 'accept_all', linkedin: null, source_url: null, sources: 0, recruiter_id: 'r1' },
  ],
};

describe('finding people with Hunter', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/find-people')) return found;
      if (path.endsWith('/people')) return { opportunity: { id: JOB }, analysis: null, fit: null, recruiters: [], emails: {}, added: 1, already_saved: 0, skipped: [] };
      throw new Error(path);
    });
  });

  it("searches only when asked, shows Hunter's own check in plain words, and adds only who you pick", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FindPeople jobId={JOB} company="Northwind Labs" />
      </QueryClientProvider>,
    );
    expect(apiMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Company website (optional)'), { target: { value: 'northwind.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search Hunter' }));
    expect(await screen.findByText(/2 found at northwind.example/)).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(`/api/jobs/${JOB}/find-people`, { method: 'POST', body: { group: 'recruiters', domain: 'northwind.example' } });
    expect(screen.getByText(/Hunter checked it: the address accepts mail/)).toBeInTheDocument();
    expect(screen.getByText(/can’t be checked/)).toBeInTheDocument();
    expect(screen.getByText('(already saved)')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Add Priya Nair'));
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 person and write emails' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`/api/jobs/${JOB}/people`, {
        method: 'POST',
        body: { people: [{ email: 'priya.nair@northwind.example', first_name: 'Priya', last_name: 'Nair', position: 'Campus Recruiter', linkedin: null, source_url: 'https://northwind.example/team' }] },
      }),
    );
    expect(await screen.findByText(/Added 1 person/)).toBeInTheDocument();
  });
});
