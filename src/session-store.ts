// ============================================================
// TestMind Phase 1 — Session Store
// Stores recorded events in memory, deduplicates input/scroll
// ============================================================

export interface RecordedEvent {
  id:          string;
  type:        string;
  url?:        string;
  timestamp:   number;
  elapsed:     number;
  selectors?:  any;
  elementInfo?:any;
  value?:      string;
  key?:        string;
  scrollX?:    number;
  scrollY?:    number;
  checked?:    boolean;
  isPassword?: boolean;
  selectedText?:string;
  title?:      string;
  [key: string]: any;
}

export class SessionStore {
  private _events   : RecordedEvent[] = [];
  private _startTime: number = 0;
  private _baseUrl  : string = '';

  startSession(): void {
    this._events    = [];
    this._startTime = Date.now();
    this._baseUrl   = '';
  }

  add(evt: RecordedEvent): RecordedEvent | null {
    if (!evt) return null;

    // Capture first URL as base URL
    if (!this._baseUrl && evt.url) this._baseUrl = evt.url;

    // Collapse consecutive input events on the same element
    if (evt.type === 'input') {
      const last = this._events[this._events.length - 1];
      if (last?.type === 'input' && last?.selectors?.primary === evt.selectors?.primary) {
        last.value     = evt.value;
        last.timestamp = evt.timestamp;
        last.elapsed   = evt.elapsed;
        return last; // Signal "updated last"
      }
    }

    // Collapse consecutive scroll events (keep only latest)
    if (evt.type === 'scroll') {
      const last = this._events[this._events.length - 1];
      if (last?.type === 'scroll') {
        this._events[this._events.length - 1] = evt;
        return evt;
      }
    }

    this._events.push(evt);
    return evt;
  }

  addNavigate(info: { url: string; title: string }): RecordedEvent {
    const evt: RecordedEvent = {
      id:        `nav_${Date.now()}`,
      type:      'navigate',
      url:       info.url,
      title:     info.title,
      timestamp: Date.now(),
      elapsed:   this.elapsed(),
    };
    if (!this._baseUrl) this._baseUrl = info.url;
    this._events.push(evt);
    return evt;
  }

  getAll():     RecordedEvent[] { return [...this._events]; }
  setAll(e: RecordedEvent[]): void { this._events = e; }
  baseUrl():    string          { return this._baseUrl; }
  count():      number          { return this._events.length; }
  elapsed():    number          { return this._startTime ? Date.now() - this._startTime : 0; }
  clear():      void            { this.startSession(); }

  toJSON() {
    return {
      version:   '1.0',
      savedAt:   new Date().toISOString(),
      baseUrl:   this._baseUrl,
      startTime: this._startTime,
      events:    this._events,
    };
  }

  load(json: any): void {
    this._events    = json.events    || [];
    this._startTime = json.startTime || Date.now();
    this._baseUrl   = json.baseUrl   || '';
  }
}
