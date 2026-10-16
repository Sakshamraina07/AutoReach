import { keepPreviousData, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type {
  ActivityItem,
  AnalyticsOverview,
  BreakdownRow,
  DuplicateSuggestion,
  FollowUp,
  Insight,
  MeResponse,
  MessageDetail,
  MessageSummary,
  Opportunity,
  OpportunityDetail,
  Paginated,
  Profile,
  Recommendation,
  RecruiterDetail,
  RecruiterSummary,
  Resume,
  Template,
  TimeseriesPoint,
  UserSettings,
} from '@autoreach/shared';
import { api, qs } from './api';

export const keys = {
  me: ['me'] as const,
  profile: ['profile'] as const,
  settings: ['settings'] as const,
  recruiters: (p: object) => ['recruiters', p] as const,
  recruiter: (id: string) => ['recruiter', id] as const,
  duplicates: ['recruiters', 'duplicates'] as const,
  opportunities: (p: object) => ['opportunities', p] as const,
  opportunity: (id: string) => ['opportunity', id] as const,
  messages: (p: object) => ['messages', p] as const,
  message: (id: string) => ['message', id] as const,
  followups: (view: string) => ['followups', view] as const,
  resumes: ['resumes'] as const,
  templates: ['templates'] as const,
  campaigns: ['campaigns'] as const,
  activity: (p: object) => ['activity', p] as const,
  analytics: (kind: string, p: object) => ['analytics', kind, p] as const,
  reviewQueue: ['review-queue'] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api<MeResponse>('/api/me'), staleTime: 15_000 });
export const useProfile = () => useQuery({ queryKey: keys.profile, queryFn: () => api<Profile | null>('/api/profile') });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api<UserSettings>('/api/settings') });

export interface RecruiterQuery {
  q?: string;
  status?: string;
  source?: string;
  tag?: string;
  opportunity_id?: string;
  role?: string;
  added_from?: string;
  added_to?: string;
  sort?: string;
  page?: number;
  page_size?: number;
}

export const useRecruiters = (p: RecruiterQuery) =>
  useQuery({ queryKey: keys.recruiters(p), queryFn: () => api<Paginated<RecruiterSummary>>(`/api/recruiters${qs({ ...p })}`), placeholderData: keepPreviousData });
export const useRecruiter = (id: string | null) =>
  useQuery({ queryKey: keys.recruiter(id ?? 'none'), queryFn: () => api<RecruiterDetail>(`/api/recruiters/${id}`), enabled: !!id });
export const useDuplicates = () => useQuery({ queryKey: keys.duplicates, queryFn: () => api<DuplicateSuggestion[]>('/api/recruiters/duplicates') });

export const useOpportunities = (p: { q?: string; status?: string; active?: string; page?: number; page_size?: number }) =>
  useQuery({ queryKey: keys.opportunities(p), queryFn: () => api<Paginated<Opportunity>>(`/api/opportunities${qs({ ...p })}`), placeholderData: keepPreviousData });
export const useOpportunity = (id: string | null) =>
  useQuery({ queryKey: keys.opportunity(id ?? 'none'), queryFn: () => api<OpportunityDetail>(`/api/opportunities/${id}`), enabled: !!id });

export const useMessages = (p: Record<string, string | number | undefined>) =>
  useQuery({ queryKey: keys.messages(p), queryFn: () => api<Paginated<MessageSummary>>(`/api/messages${qs(p)}`), placeholderData: keepPreviousData, refetchInterval: 30_000 });
export const useMessage = (id: string | null) =>
  useQuery({ queryKey: keys.message(id ?? 'none'), queryFn: () => api<MessageDetail>(`/api/messages/${id}`), enabled: !!id });

export const useFollowUps = (view: 'due' | 'upcoming' | 'all_pending' | 'closed') =>
  useQuery({ queryKey: keys.followups(view), queryFn: () => api<Paginated<FollowUp>>(`/api/followups?view=${view}&page_size=100`), refetchInterval: 60_000 });

export const useResumes = () => useQuery({ queryKey: keys.resumes, queryFn: () => api<Resume[]>('/api/resumes') });
export const useTemplates = () => useQuery({ queryKey: keys.templates, queryFn: () => api<Template[]>('/api/templates') });
export const useCampaigns = () =>
  useQuery({ queryKey: keys.campaigns, queryFn: () => api<{ id: string; name: string; description: string | null; sent: number }[]>('/api/campaigns') });
export const useActivity = (p: { page?: number; page_size?: number; recruiter_id?: string }) =>
  useQuery({ queryKey: keys.activity(p), queryFn: () => api<Paginated<ActivityItem>>(`/api/activity${qs(p)}`), refetchInterval: 30_000 });

export const useOverview = (range: string) =>
  useQuery({ queryKey: keys.analytics('overview', { range }), queryFn: () => api<AnalyticsOverview>(`/api/analytics/overview?range=${range}`), refetchInterval: 60_000 });
export const useTimeseries = (range: string) =>
  useQuery({ queryKey: keys.analytics('timeseries', { range }), queryFn: () => api<TimeseriesPoint[]>(`/api/analytics/timeseries?range=${range}`) });
export const useBreakdown = (by: string, range: string) =>
  useQuery({
    queryKey: keys.analytics('breakdown', { by, range }),
    queryFn: () => api<{ by: string; small_sample_threshold: number; rows: BreakdownRow[] }>(`/api/analytics/breakdown?by=${by}&range=${range}`),
  });
export const useInsights = (range: string) => useQuery({ queryKey: keys.analytics('insights', { range }), queryFn: () => api<Insight[]>(`/api/analytics/insights?range=${range}`) });
export const useRecommendations = () => useQuery({ queryKey: keys.analytics('recommendations', {}), queryFn: () => api<Recommendation[]>('/api/analytics/recommendations') });

export interface ReviewItem {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  received_at: string;
  classification: string;
  matched_message_id: string | null;
  original_subject: string | null;
  recipient_email: string | null;
  recruiter_name: string | null;
  gmail_thread_id: string;
}
export const useReviewQueue = () => useQuery({ queryKey: keys.reviewQueue, queryFn: () => api<ReviewItem[]>('/api/review-queue'), refetchInterval: 60_000 });

/** Invalidate everything that summarises outreach after a mutation. */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...extra: QueryKey[]) => {
    const prefixes: QueryKey[] = [['me'], ['recruiters'], ['recruiter'], ['opportunities'], ['opportunity'], ['messages'], ['message'], ['followups'], ['activity'], ['analytics'], ['review-queue'], ...extra];
    return Promise.all(prefixes.map((k) => qc.invalidateQueries({ queryKey: k })));
  };
}
