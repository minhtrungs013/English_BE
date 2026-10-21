import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { Model } from 'mongoose';
import * as nodemailer from 'nodemailer';

export type OtpPurpose = 'register' | 'reset';

const TTL_MS = 10 * 60_000;
const RESEND_MS = 60_000;
const MAX_ATTEMPTS = 5;

/** A one-time code sent by email. One per email + purpose; a new code replaces the old one. */
@Schema({ collection: 'otps', timestamps: true })
export class Otp {
  @Prop({ required: true }) email: string;
  @Prop({ required: true }) purpose: string;
  @Prop({ required: true }) codeHash: string;
  @Prop({ required: true }) expiresAt: Date;
  @Prop({ default: 0 }) attempts: number;
  @Prop({ required: true }) sentAt: Date;
  /** Sign-up only: the name and password hash, so the account is created after the code is checked. */
  @Prop({ type: Object, default: null }) payload: { name: string; passwordHash: string } | null;
}
export const OtpSchema = SchemaFactory.createForClass(Otp);
OtpSchema.index({ email: 1, purpose: 1 }, { unique: true });
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Sends mail. With BREVO_API_KEY it uses Brevo's HTTPS API (works on hosts that block SMTP ports, such as Render's free plan);
 * otherwise SMTP (Gmail: smtp.gmail.com, port 465, an App Password). With neither it only logs the mail.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private readonly tx: nodemailer.Transporter | null;
  private readonly brevoKey: string | undefined;
  private readonly fromName: string;
  private readonly fromEmail: string;

  constructor(config: ConfigService) {
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASS');
    const port = Number(config.get('SMTP_PORT', 465));
    this.brevoKey = config.get<string>('BREVO_API_KEY');
    this.tx = !this.brevoKey && user && pass
      ? nodemailer.createTransport({ host: config.get('SMTP_HOST', 'smtp.gmail.com'), port, secure: port === 465, auth: { user, pass }, connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 20_000 })
      : null;
    // MAIL_FROM: "Wordbook <you@gmail.com>" or just the address.
    const from = config.get<string>('MAIL_FROM') || (user ? 'Wordbook <' + user + '>' : '');
    const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
    this.fromName = m ? m[1] || 'Wordbook' : 'Wordbook';
    this.fromEmail = m ? m[2] : from.trim();
  }

  async send(to: string, subject: string, text: string, html: string): Promise<void> {
    if (this.brevoKey) {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': this.brevoKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { name: this.fromName, email: this.fromEmail }, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
        signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok) throw new Error('Brevo ' + res.status + ': ' + (await res.text().catch(() => '')).slice(0, 300));
      return;
    }
    if (!this.tx) { this.log.warn('Mail not configured. Mail to ' + to + ': ' + text); return; }
    await this.tx.sendMail({ from: this.fromName + ' <' + this.fromEmail + '>', to, subject, text, html });
  }
}

@Injectable()
export class OtpService {
  private readonly log = new Logger('Otp');

  constructor(
    @InjectModel(Otp.name) private readonly otps: Model<Otp>,
    private readonly mail: MailService,
    private readonly config: ConfigService
  ) {}

  private hash(email: string, purpose: string, code: string): string {
    return createHash('sha256').update(this.config.getOrThrow<string>('JWT_SECRET') + '|' + email + '|' + purpose + '|' + code).digest('hex');
  }

  /** Creates (or replaces) the code and emails it. At most one email a minute per address and purpose. */
  async issue(email: string, purpose: OtpPurpose, payload: Otp['payload'] = null): Promise<void> {
    const old = await this.otps.findOne({ email, purpose });
    if (old && Date.now() - old.sentAt.getTime() < RESEND_MS) {
      const s = Math.ceil((RESEND_MS - (Date.now() - old.sentAt.getTime())) / 1000);
      throw new HttpException({ statusCode: 429, message: 'Please wait ' + s + ' seconds before asking for a new code.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const now = new Date();
    await this.otps.updateOne(
      { email, purpose },
      { $set: { codeHash: this.hash(email, purpose, code), expiresAt: new Date(now.getTime() + TTL_MS), attempts: 0, sentAt: now, payload: payload ?? old?.payload ?? null } },
      { upsert: true }
    );
    const what = purpose === 'register' ? 'xác nhận email đăng ký' : 'đặt lại mật khẩu';
    const text = 'Mã ' + what + ' Wordbook của bạn là ' + code + '. Mã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.';
    const html = '<div style="font-family:sans-serif;font-size:15px;color:#222"><p>Mã ' + what + ' Wordbook của bạn:</p>'
      + '<p style="font-size:30px;font-weight:bold;letter-spacing:6px;margin:16px 0">' + code + '</p>'
      + '<p>Mã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p></div>';
    try {
      await this.mail.send(email, 'Wordbook: mã ' + code, text, html);
    } catch (e) {
      this.log.error('Sending mail failed: ' + String(e));
      await this.otps.deleteOne({ email, purpose });
      throw new HttpException({ statusCode: 503, message: 'Could not send the email. Please try again later.' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async exists(email: string, purpose: OtpPurpose): Promise<boolean> {
    return !!(await this.otps.exists({ email, purpose, expiresAt: { $gt: new Date() } }));
  }

  /** Checks the code; on success removes it and returns its payload. Wrong codes count; 5 wrong ones end the code. */
  async verify(email: string, purpose: OtpPurpose, code: string): Promise<Otp['payload']> {
    const o = await this.otps.findOne({ email, purpose });
    if (!o || o.expiresAt.getTime() < Date.now()) throw new BadRequestException('The code has expired. Please ask for a new one.');
    if (o.attempts >= MAX_ATTEMPTS) throw new BadRequestException('Too many wrong tries. Please ask for a new code.');
    const a = Buffer.from(this.hash(email, purpose, code.trim()));
    const b = Buffer.from(o.codeHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      await this.otps.updateOne({ _id: o._id }, { $inc: { attempts: 1 } });
      const left = MAX_ATTEMPTS - o.attempts - 1;
      throw new BadRequestException(left > 0 ? 'Wrong code. ' + left + ' tries left.' : 'Too many wrong tries. Please ask for a new code.');
    }
    await this.otps.deleteOne({ _id: o._id });
    return o.payload;
  }
}
