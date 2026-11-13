# Korwell login branding

This handoff uses Cloudflare Access's built-in login screen. Open the
[local mockup](preview.html) to see the email and code steps. The mockup
approximates Cloudflare's layout. Use the dashboard's Preview card to check
the actual result before saving.

## Settings for Bine

In **Cloudflare One → Reusable components → Custom pages → Access login page**,
select **Manage**. Use these values:

| Field | Value |
| --- | --- |
| Header text | The Kaldi Archive |
| Background color | `#F2F0ED` |
| Text color, if shown | `#382811` |
| Footer text | Sign in with your @kaldi.si work email. |
| Logo URL | `https://raw.githubusercontent.com/bine-cadez/hackathon-kaldi-korwell/7e7df63528e5e0c33fad5099a2ec3f1897b20935/public/korwell-eye.svg` |

The logo URL is a public, versioned copy of the Korwell eye. It loads before
sign-in. Keep the existing organization name and authentication settings.

These branding settings are shared by Access applications in the same Zero
Trust organization. Check that the branding fits the other applications
before saving. Then open the test Worker in a private window and confirm that
the eye and copy appear and the one-time code flow still works.

[Cloudflare's login branding guide](https://developers.cloudflare.com/cloudflare-one/reusable-components/custom-pages/access-login-page/)
