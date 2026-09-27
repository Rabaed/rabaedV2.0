# Two independent Instances on AWS: standard outside KSA, premium inside KSA

Some customers (government, semi-government) require data hosted in Saudi Arabia, which costs much more, while most don't. We run two permanent, independent Instances of the same codebase on AWS: a standard Instance in a Gulf region outside KSA (launched first) and a premium Instance in AWS's Saudi region. The Instance is chosen per Project, because residency is an Owner's contractual requirement; Companies and Members on a KSA Project are onboarded on the KSA Instance separately, and single sign-on across Instances may come later. There is no migration between Instances.

## Considered Options

Vercel + Supabase was rejected because Supabase has no Saudi region, which would force a second, different stack for the premium Instance. Choosing the Instance per Company was rejected because it would stop a standard-Instance Contractor from joining a KSA Owner's Project.

## Consequences

Data residency is a PDPL/NCA matter, separate from SOC 2, which covers security controls on both Instances. Everything is deployed as infrastructure-as-code so both Instances stay identical.
