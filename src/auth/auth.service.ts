import { ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DataService } from '../data/data';
import { LibraryService } from '../library/library.service';
import { ProfileService } from '../profile/profile.service';
import { PublicUser, User, UserDocument, publicUser } from '../users/user.schema';
import { ChangePasswordDto, LoginDto, RegisterDto } from './auth.dto';
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
    private readonly library: LibraryService
  ) {}

  private async issue(u: UserDocument): Promise<AuthResponse> {
    const accessToken = await this.jwt.signAsync({ sub: String(u._id), email: u.email });
    return { accessToken, user: publicUser(u) };
  }

  async register(dto: RegisterDto): Promise<AuthResponse> {
    if (await this.users.exists({ email: dto.email })) throw new ConflictException('An account with this email already exists.');
    let u: UserDocument;
    try {
      u = await this.users.create({ name: dto.name, email: dto.email, passwordHash: await hashPassword(dto.password) });
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
