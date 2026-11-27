/** The apps do not send statistics yet; the web version is analytics.web.ts. */
export { eventDetails } from './analytics-details';

export function startAnalytics() {}

export function track(_name: string, _properties?: Record<string, unknown>) {}
