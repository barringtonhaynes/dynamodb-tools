# ADR 0002: AWS identity and deliberate writes

Status: accepted; records explicit user requirements and the implemented behavior.

The FastAPI Backend uses a shared boto3 factory, standard credential discovery,
optional profile/region overrides and service-specific endpoints. Connection
preferences contain no credentials. AWS defaults to read-only, has no startup
mutations, and displays the account and region. Every live write is confirmed
server-side with an exact-request approval, typed target phrase, delay and expiry.
The Browser Console keeps purge/delete inside a collapsed Danger zone. These
controls prevent accidents; IAM remains the authorization boundary.

Table listing and metadata permissions are handled separately so one restricted
table cannot break the list. Missing ListTables permission permits manually
opening a known table, subject to its own permissions.

Evidence: commits 96ed583, c3310fc, 968c322; app/connection.py and app/aws_safety.py.
Live-account verification remains uncompleted; AWS tests use controlled fixtures.
