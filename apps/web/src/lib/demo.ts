// The hackathon demo runs as one user (no auth). Everything else is keyed by user id,
// so adding real accounts later only means replacing getCurrentUser().
export const DEMO_USER = {
  name: "Sam Rivera",
  email: "sam@sayitpayit.demo",
  homeCurrency: "USD",
  language: "en",
  country: "US",
  timezone: "Asia/Kolkata",
} as const;
