import { translate, type MessageKey, type Vars } from "./index";
import type { Locale } from "./locale";

type Rule = { match: RegExp; key: MessageKey; vars?: (m: RegExpMatchArray) => Vars };

const exact = (text: string, key: MessageKey): Rule => ({
  match: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
  key,
});

const RULES: Rule[] = [
  exact("another subject already has this name", "errors.subjectNameTaken"),
  exact("choose a different subject of the same semester", "errors.mergeTarget"),
  exact("edit the class note to rename this task", "errors.renameInNote"),
  exact("remove the line from the class note to delete this task", "errors.deleteInNote"),
  exact("end date must be on or after start date", "errors.endBeforeStartDate"),
  exact("end must be after start and within 24 hours", "errors.endBeforeStart"),
  exact("event not found", "errors.eventNotFound"),
  exact("repeating event not found", "errors.ruleNotFound"),
  exact("semester not found", "errors.semesterNotFound"),
  exact("subject not found", "errors.subjectNotFound"),
  exact("task not found", "errors.taskNotFound"),
  exact("unknown subject", "errors.unknownSubject"),
  exact("unknown subject or section", "errors.unknownSection"),
  exact("school classes cannot be edited or deleted", "errors.schoolReadOnly"),
  exact("no active semester", "errors.noActiveSemester"),
  exact("range must be longer than 0 and at most 42 days", "errors.rangeTooLong"),
  exact("week_start must be a Monday", "errors.weekStartMonday"),
  exact("Paste the Zeus ICS link (or its key)", "errors.pasteZeusLink"),
  exact("missing bearer token", "errors.signInAgain"),
  exact("invalid token", "errors.sessionExpired"),
  exact("Failed to fetch", "errors.offline"),
  exact("server is missing TOKEN_ENCRYPTION_KEY", "errors.missingKey"),
  exact("no Zeus ICS link configured", "errors.noZeusLink"),
  exact("active semester has no Zeus group id", "errors.noGroupId"),
  exact("Zeus rejected the ICS link", "errors.zeusRejected"),
  { match: /^Zeus returned HTTP (\d+)$/, key: "errors.zeusHttp", vars: (m) => ({ status: m[1] }) },
  { match: /^network error \((\w+)\)$/, key: "errors.network", vars: (m) => ({ type: m[1] }) },
  { match: /^invalid feed: feed looks like a different group/, key: "errors.otherGroup" },
  { match: /^invalid feed: feed contains no events$/, key: "errors.emptyFeed" },
  { match: /^invalid feed: response is not an iCalendar document$/, key: "errors.notIcal" },
  { match: /^invalid feed: could not parse calendar/, key: "errors.unparsable" },
  { match: /^invalid feed: (.*)$/, key: "errors.invalidFeed", vars: (m) => ({ detail: m[1] }) },
  { match: /^unexpected error \((\w+)\)$/, key: "errors.unexpected", vars: (m) => ({ type: m[1] }) },
  { match: /^kept (\d+) upcoming classes that disappeared from the feed/, key: "errors.keptMissing", vars: (m) => ({ count: m[1] }) },
  exact("Google Calendar is not connected", "errors.googleNotConnected"),
  exact("Reconnect Google to enable documents", "documents.reconnect"),
  { match: /^Google Calendar is not set up on the server yet/, key: "errors.googleNotSetUp" },
  { match: /^Google Calendar refused the connection: (.*)$/, key: "errors.googleRefused", vars: (m) => ({ detail: m[1] }) },
  exact("That Google token is not valid", "errors.googleTokenInvalid"),
  exact("Google access was revoked or expired — reconnect Google in Settings", "errors.googleRevoked"),
  exact("Google Calendar permission is missing — reconnect Google in Settings", "errors.googlePermission"),
  exact("Google rejected the server's client id/secret", "errors.googleClientRejected"),
  { match: /^Google Calendar returned (\d+) \((.*)\)$/, key: "errors.googleStatusReason", vars: (m) => ({ status: m[1], reason: m[2] }) },
  { match: /^Google Calendar returned (\d+)$/, key: "errors.googleStatus", vars: (m) => ({ status: m[1] }) },
  { match: /^Google sign-in returned (\d+)$/, key: "errors.googleSignIn", vars: (m) => ({ status: m[1] }) },
  exact("Google rate limit reached; the rest is sent on the next push", "errors.googleRateLimited"),
  exact("Another push is already running", "errors.googleBusy"),
  exact("Google is not connected any more — connect it again in Settings", "errors.googleGone"),
  exact("A timetable row changed while pushing; it is retried on the next push", "errors.googleRowChanged"),
  exact("Could not reach Google", "errors.googleUnreachable"),
  exact("Google sent an unexpected response", "errors.googleUnexpected"),
  exact('The "My Timetable" calendar is gone from Google; it will be recreated on the next push.', "errors.calendarGone"),
];

/** Shows a known English server text in the chosen language; unknown texts stay as they are. */
export function translateServerMessage(text: string, locale: Locale): string {
  if (locale === "en") return text;
  for (const rule of RULES) {
    const m = text.match(rule.match);
    if (m) return translate(locale, rule.key, rule.vars?.(m));
  }
  return text;
}
