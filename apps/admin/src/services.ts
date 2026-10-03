// Rabaed Admin's domain services, for the demo seed and the customer api's
// tests, which onboard Companies as a Rabaed Engineer would, without the
// admin service's HTTP sign-in. Never imported by the customer api itself
// (apps/api/src/admin-boundary.test.ts checks).
export { asEngineer } from "./admin-action.ts";
export { createEngineer } from "./engineers.ts";
export { publishFormVersion, rabaedDefaultFormId, type PublishFormResult } from "./forms.ts";
export { closeOnboardingLead, listOnboardingLeads, type CloseLeadResult } from "./onboarding-leads.ts";
export { inviteAuthorizedPerson, onboardCompany, type OnboardingResult } from "./onboarding.ts";
export { addOption, createOptionList, listOptionLists, renameOption, setOptionRetired } from "./option-lists.ts";
