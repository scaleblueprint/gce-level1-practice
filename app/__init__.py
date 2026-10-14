import os

# This practice app is intentionally multi-user: every learner registers with
# their own email/password and receives an independent session and attempt history.
os.environ["SINGLE_USER"] = "false"
os.environ["REGISTRATION_CODE"] = ""
