// Types based on Google Calendar infrastructure (RFC 5545)

export type EventStatus = 'confirmed' | 'tentative' | 'cancelled';
export type EventVisibility = 'default' | 'public' | 'private' | 'confidential';
export type EventTransparency = 'opaque' | 'transparent';
export type AttendeeResponse = 'needsAction' | 'accepted' | 'declined' | 'tentative';
export type ReminderMethod = 'popup' | 'email' | 'sms' | 'webhook';
export type CalendarViewType = 'day' | 'week' | 'month';

export interface CalendarEvent {
  id: string;
  calendar_id: string;
  creator_id: string;
  title: string;
  description?: string;
  location?: string;
  meet_link?: string;
  color?: string;
  status: EventStatus;
  start_time: Date;
  end_time: Date;
  all_day: boolean;
  recurrence?: string[];
  recurring_event_id?: string;
  visibility: EventVisibility;
  transparency: EventTransparency;
  attendees: Attendee[];
  reminders: Reminder[];
  created: Date;
  updated: Date;
}

export interface Attendee {
  id: string;
  email: string;
  name: string;
  response_status: AttendeeResponse;
  is_organizer: boolean;
  is_optional: boolean;
  avatar_url?: string;
}

export interface Reminder {
  id: string;
  method: ReminderMethod;
  minutes_before: number;
}

export interface CalendarInfo {
  id: string;
  name: string;
  color: string;
  is_primary: boolean;
  visible: boolean;
}
