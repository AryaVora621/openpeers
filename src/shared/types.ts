export interface Peer {
  id: string;
  pid: number;
  cwd: string;
  tty: string | null;
  summary: string;
  last_seen: string;
}

export interface RegisterRequest {
  pid: number;
  cwd: string;
  tty: string | null;
  summary: string;
}

export interface RegisterResponse {
  id: string;
}

export interface Message {
  id: number;
  to_id: string;
  from_id: string;
  text: string;
  sent_at: string;
  read: boolean;
}

export interface PollMessagesResponse {
  messages: Message[];
}
