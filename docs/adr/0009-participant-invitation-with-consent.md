# Companies join a Project by accepting an invitation, and a CR lookup never reveals who is on Rabaed

A Project Admin adds another Company to a Project by its CR number, since there is no Company directory to browse (a directory would expose Rabaed's customer list). Two problems followed from adding it directly: a Project Admin could test, one CR number at a time, whether a company is a Rabaed customer from the "unknown company" answer, and a Company could be bound to a Project and a Project Role, with its name shown to others, without agreeing to it.

We decided that adding a Company creates a **Participant Invitation**. The Project Admin always gets the same answer — "If this company is on Rabaed, its Authorized Person will receive the invitation; if not, Rabaed will contact you to onboard them" — so nothing reveals whether a CR number belongs to a customer. An unknown CR number becomes an onboarding lead for Rabaed Admin (only Rabaed onboards Companies). The invited Company's Authorized Person sees the Project name, Host Company and offered Project Role, and accepts or declines; only on acceptance does the Company become a Participant and appear anywhere in the Project (visibility rule V15).

## Considered Options

- **Keep the direct add with a "not on Rabaed" error:** rejected; it lets anyone with Project Admin rights probe the customer list, even though KSA CR numbers are public.
- **Look Companies up by the Authorized Person's email:** rejected; emails are personal data and just as probeable.
- **Direct add without consent:** rejected; a Company must not be bound to a Project Role, and named to others, without its Authorized Person agreeing.

## Consequences

Participants gain an **Invited** state before **Active**. A Project cannot hand work to a Company until it has accepted, so Project setup takes one more step on the invited side.
