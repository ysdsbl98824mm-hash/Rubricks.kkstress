export type Choice = { label: string; points: number };
export type Question = { slot: number; id: string; grp: string; text: string; choices: Choice[] };
export type Answer = { q: string; p: number };
export type Person = { id: string; name: string };

export type Report = {
  date: string;
  start_time: string | null;
  end_time: string | null;
  sleep_hours: number | null;
  did: string;
  has_deliverable: boolean;
  deliverable_note: string;
  feelings: string;
};

export type DayData = {
  date: string;
  cycle_day: number;
  questions: Question[];
  report: Report | null;
  answers: Answer[] | null;
  reviews: { to_member_id: string; note: string }[];
  directory: Person[];
};

export type DaySubmit = Report & { answers: Answer[]; reviews: { to: string; note: string }[] };

export type Me = { id: string; name: string; email: string; is_operator: boolean; is_representative: boolean; consent_at: string | null };

export type HistoryDay = Report & {
  work_hours: number | null;
  stress: { score: number; answers: { q: string; text: string; label: string; p: number }[] } | null;
  stage: { value: number; name: string; raised: boolean } | null;
};

export type AccessLog = { at: string; actor_name: string; range_from: string; range_to: string; reason: string; target_name?: string; notified?: boolean };

export type MyData = {
  me: Me;
  latest_stage: { date: string; value: number; name: string } | null;
  days: HistoryDay[];
  reviews_to_me: { date: string; note: string; from: string }[];
  access_log: AccessLog[];
  rests: { start_date: string; end_date: string | null }[];
};

export type ContactMsg = { id: string; to_role: 'operator' | 'representative'; from?: string; body: string; read_at: string | null; created_at: string };
export type ContactData = { can_receive: string[]; inbox: ContactMsg[]; sent: ContactMsg[] };

export type MemberRow = {
  id: string; name: string; email?: string; notify_email?: string | null; is_operator?: boolean; is_representative?: boolean;
  status: string; retired_at: string | null; consent_at?: string | null; sheet_id?: string | null; auth_user_id?: string | null;
};
export type OpsData = {
  me: { id: string; is_operator: boolean; is_representative: boolean };
  judged_date: string | null;
  members: MemberRow[];
  danger: { member_id: string; name: string; date: string; stage: number; stage_name: string; raised: boolean; baseline_high: boolean }[];
  rests: { id: string; member_id: string; start_date: string; end_date: string | null }[];
  reassignments: { id: string; from_name: string; to_names: string; note: string; created_at: string; notified_at: string | null }[];
  deletion_requests: { id: string; member_id: string | null; member_name: string; requested_at: string; approved_at: string | null; executed_at: string | null }[];
  access_log: (AccessLog & { target_name: string })[];
  failed_notifications: { at: string; kind: string; to_address: string; error: string | null }[];
};

export type InspectResult = {
  target: Person; from: string; to: string; notified: boolean;
  days: (Report & { stress: { score: number | null; answers: { text: string; p: number }[] } | null })[];
};

export const STAGES = ['健康', 'やや偏りあり', '不安定', '危険', '今すぐ休息'];
