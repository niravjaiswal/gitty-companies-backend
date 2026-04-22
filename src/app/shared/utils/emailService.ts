import { Resend } from 'resend';

interface InviteEmailOptions {
  to: string;
  companyName: string;
  assessmentTitle: string;
  durationMinutes: number;
  loginUrl: string;
}

function inviteHtml(opts: InviteEmailOptions): string {
  const { companyName, assessmentTitle, durationMinutes, loginUrl } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You've been invited to a technical assessment</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Logo -->
          <tr>
            <td style="padding-bottom:32px;">
              <span style="font-size:22px;font-weight:600;color:#ffffff;letter-spacing:0.04em;">gitty</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#141414;border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:40px;">

              <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.32em;color:rgba(255,255,255,0.4);">Technical Assessment</p>
              <h1 style="margin:0 0 16px;font-size:26px;font-weight:600;color:#ffffff;line-height:1.3;">You've been invited</h1>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:rgba(255,255,255,0.62);">
                <strong style="color:#ffffff;">${companyName}</strong> wants you to complete a technical assessment as part of their hiring process.
              </p>

              <!-- Assessment card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.28em;color:rgba(255,255,255,0.38);">Assessment</p>
                    <p style="margin:0 0 12px;font-size:17px;font-weight:500;color:#ffffff;">${assessmentTitle}</p>
                    <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.5);">${durationMinutes} minute time limit &nbsp;·&nbsp; AI-native coding environment</p>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#7c3aed;border-radius:100px;">
                    <a href="${loginUrl}" style="display:inline-block;padding:14px 32px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.02em;">Start Assessment →</a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 6px;font-size:13px;color:rgba(255,255,255,0.38);">Or paste this link into your browser:</p>
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.55);word-break:break-all;">${loginUrl}</p>

              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:28px 0;" />

              <p style="margin:0;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.35);">
                Sign in with this email address and your assessment will appear automatically. If you weren't expecting this, you can ignore this message.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;">
              <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.25);">Sent by gitty · AI-native technical hiring</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function inviteText(opts: InviteEmailOptions): string {
  const { companyName, assessmentTitle, durationMinutes, loginUrl } = opts;
  return `You've been invited to a technical assessment by ${companyName}.

Assessment: ${assessmentTitle}
Duration: ${durationMinutes} minutes

Sign in with this email address to claim and start your assessment:
${loginUrl}

If you weren't expecting this, you can ignore this message.

— gitty · AI-native technical hiring`;
}

export class EmailService {
  private resend: Resend | null;
  private fromAddress: string;

  constructor() {
    const key = process.env.RESEND_API_KEY ?? '';
    this.resend = key ? new Resend(key) : null;
    this.fromAddress = process.env.EMAIL_FROM ?? 'gitty <noreply@gitty.ai>';
  }

  get isConfigured(): boolean {
    return this.resend !== null;
  }

  async sendAssessmentInvite(opts: InviteEmailOptions): Promise<{ sent: boolean; error?: string }> {
    if (!this.resend) {
      return { sent: false, error: 'RESEND_API_KEY not configured' };
    }

    try {
      const { error } = await this.resend.emails.send({
        from: this.fromAddress,
        to: opts.to,
        subject: `${opts.companyName} has invited you to a technical assessment`,
        html: inviteHtml(opts),
        text: inviteText(opts),
      });

      if (error) {
        return { sent: false, error: error.message };
      }

      return { sent: true };
    } catch (err) {
      return { sent: false, error: err instanceof Error ? err.message : 'Email send failed' };
    }
  }

  async sendBulkAssessmentInvites(
    recipients: string[],
    companyName: string,
    assessmentTitle: string,
    durationMinutes: number,
    loginUrl: string,
    logger: { warn: (msg: string) => void },
  ): Promise<{ sentCount: number; failedCount: number }> {
    if (!this.resend) {
      logger.warn('Email sending skipped: RESEND_API_KEY not configured');
      return { sentCount: 0, failedCount: 0 };
    }

    let sentCount = 0;
    let failedCount = 0;

    await Promise.all(
      recipients.map(async (to) => {
        const result = await this.sendAssessmentInvite({ to, companyName, assessmentTitle, durationMinutes, loginUrl });
        if (result.sent) {
          sentCount++;
        } else {
          failedCount++;
          logger.warn(`Failed to send invite to ${to}: ${result.error}`);
        }
      }),
    );

    return { sentCount, failedCount };
  }
}

export const emailService = new EmailService();
