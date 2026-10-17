import type { CareerOpsOverview } from '@autoreach/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import type * as ApiModule from '../lib/api';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof ApiModule>()), api: apiMock }));
const { default: CareerOps } = await import('../pages/CareerOps');

const job = (n: number, over: Partial<CareerOpsOverview['jobs'][number]>): CareerOpsOverview['jobs'][number] => ({
  report_number: n,
  report_file: `${String(n).padStart(3, '0')}-x-2026-10-15.md`,
  company: 'Northwind Labs',
  role: 'Backend Intern',
  score: 4.5,
  legitimacy: 'High Confidence',
  date: '2026-10-15',
  url: null,
  status: null,
  description: 'report',
  opportunity_id: null,
  ...over,
});

const overview: CareerOpsOverview = {
  jobs: [
    job(1, {}),
    job(2, { company: 'Contoso', role: 'Platform Intern', score: 4.1, description: 'none', url: 'https://careers.contoso.example/9' }),
    job(3, { company: 'Tailspin', role: 'SDE Intern', score: 2.5 }),
    job(4, { company: 'Fabrikam', role: 'Web Intern', score: 4.8, status: 'SKIP' }),
    job(5, { company: 'Litware', role: 'API Intern', score: 4.2, opportunity_id: '55555555-5555-4555-8555-555555555555' }),
  ],
  unreadable: [],
  cv_exists: false,
};

function Where() {
  const l = useLocation();
  return <p>at {l.pathname + l.search}</p>;
}

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/career-ops']}>
          <Routes>
            <Route path="/career-ops" element={<CareerOps />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('career-ops page', () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/api/career-ops') return overview;
      if (path === '/api/career-ops/reports/1/import') return { opportunity: { id: '11111111-1111-4111-8111-111111111111' } };
      throw new Error(`unexpected ${path}`);
    });
  });

  it('shows the good jobs best first and hides low scores and skipped ones until asked', async () => {
    setup();
    expect(await screen.findByText('Backend Intern')).toBeInTheDocument();
    const roles = screen.getAllByText(/Intern$/).map((e) => e.textContent);
    expect(roles).toEqual(['Backend Intern', 'API Intern', 'Platform Intern']); // 4.5, 4.2, 4.1
    expect(screen.queryByText('SDE Intern')).toBeNull(); // 2.5
    expect(screen.queryByText('Web Intern')).toBeNull(); // marked SKIP in career-ops
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByText('SDE Intern')).toBeInTheDocument();
    expect(screen.getByText('Web Intern')).toBeInTheDocument();
  });

  it('offers the right next step for each job', async () => {
    setup();
    await screen.findByText('Backend Intern');
    expect(screen.getByRole('link', { name: 'Open job' })).toHaveAttribute('href', '/jobs/55555555-5555-4555-8555-555555555555');
    expect(screen.getByRole('link', { name: 'Paste description' })).toHaveAttribute(
      'href',
      `/jobs/new?url=${encodeURIComponent('https://careers.contoso.example/9')}&company=Contoso&role=Platform+Intern`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Write emails' }));
    expect(await screen.findByText('at /jobs/11111111-1111-4111-8111-111111111111')).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith('/api/career-ops/reports/1/import', { method: 'POST' });
  });
});
