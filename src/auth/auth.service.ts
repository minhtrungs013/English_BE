import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DataService } from '../data/data';
import { LibraryService } from '../library/library.service';
import { ProfileService } from '../profile/profile.service';
import { PublicUser, User, UserDocument, publicUser } from '../users/user.schema';
import { ChangePasswordDto, EmailDto, LoginDto, RegisterDto, ResetPasswordDto, VerifyCodeDto } from './auth.dto';
import { OtpService } from './otp';
import { hashPassword, verifyPassword } from './password';

export interface AuthResponse { accessToken: string; user: PublicUser }

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly jwt: JwtService,
    private readonly data: DataService,
    private readonly profile: ProfileService,
    private readonly library: LibraryService,
    private readonly otp: OtpService
  ) {}

  private async issue(u: UserDocument): Promise<AuthResponse> {
    const accessToken = await this.jwt.signAsync({ sub: String(u._id), email: u.email });
    return { accessToken, user: publicUser(u) };
  }

  /** Step 1 of sign-up: keeps the details and emails a 6-digit code. The account is created by verifyRegister. */
  async register(dto: RegisterDto): Promise<{ email: string }> {
    if (await this.users.exists({ email: dto.email })) throw new ConflictException('An account with this email already exists.');
    await this.otp.issue(dto.email, 'register', { name: dto.name, passwordHash: await hashPassword(dto.password) });
    return { email: dto.email };
  }

  /** Sends the sign-up code again (the details are kept from register). */
  async resendRegister(dto: EmailDto): Promise<void> {
    if (!(await this.otp.exists(dto.email, 'register'))) throw new BadRequestException('Your sign-up has expired. Please sign up again.');
    await this.otp.issue(dto.email, 'register');
  }

  /** Step 2 of sign-up: the right code creates the account. */
  async verifyRegister(dto: VerifyCodeDto): Promise<AuthResponse> {
    const p = await this.otp.verify(dto.email, 'register', dto.code);
    if (!p) throw new BadRequestException('Your sign-up has expired. Please sign up again.');
    if (await this.users.exists({ email: dto.email })) throw new ConflictException('An account with this email already exists.');
    let u: UserDocument;
    try {
      u = await this.users.create({ name: p.name, email: dto.email, passwordHash: p.passwordHash });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ConflictException('An account with this email already exists.');
      throw e;
    }
    const id = String(u._id);
    // The first account inherits vocabulary saved before accounts existed; others start empty
    // and add words from the shared library.
    await this.data.claimUnownedData(id);
    await this.profile.get(id);
    this.log.log('New account: ' + id);
    return this.issue(u);
  }

  /** Emails a reset code when the account exists. Says nothing either way, so emails can't be probed. */
  async forgotPassword(dto: EmailDto): Promise<void> {
    if (!(await this.users.exists({ email: dto.email }))) return;
    try { await this.otp.issue(dto.email, 'reset'); } catch (e) {
      if (e instanceof HttpException && e.getStatus() === 429) return;
      throw e;
    }
  }

  async resetPassword(dto: ResetPasswordDto): Promise<AuthResponse> {
    await this.otp.verify(dto.email, 'reset', dto.code);
    const u = await this.users.findOne({ email: dto.email });
    if (!u) throw new BadRequestException('The code has expired. Please ask for a new one.');
    u.passwordHash = await hashPassword(dto.password);
    await u.save();
    this.log.log('Password reset: ' + String(u._id));
    return this.issue(u);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const u = await this.users.findOne({ email: dto.email });
    // Same message for unknown email and wrong password, so emails can't be probed.
    if (!u || !(await verifyPassword(dto.password, u.passwordHash))) throw new UnauthorizedException('Incorrect email or password.');
    return this.issue(u);
  }

  async me(id: string): Promise<PublicUser> {
    const u = await this.users.findById(id);
    if (!u) throw new UnauthorizedException('Your account no longer exists. Please sign up again.');
    return publicUser(u);
  }

  async updateName(id: string, name: string): Promise<PublicUser> {
    const u = await this.users.findByIdAndUpdate(id, { $set: { name } }, { returnDocument: 'after', runValidators: true });
    if (!u) throw new NotFoundException('Account not found');
    await this.library.renameAuthor(id, u.name);
    return publicUser(u);
  }

  async changePassword(id: string, dto: ChangePasswordDto): Promise<void> {
    const u = await this.users.findById(id);
    if (!u) throw new NotFoundException('Account not found');
    if (!(await verifyPassword(dto.currentPassword, u.passwordHash))) throw new UnauthorizedException('Current password is incorrect.');
    u.passwordHash = await hashPassword(dto.newPassword);
    await u.save();
  }

  async deleteAccount(id: string): Promise<void> {
    await this.data.deleteAccount(id);
  }
}
