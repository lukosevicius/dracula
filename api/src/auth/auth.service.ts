import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { DatabaseService } from '../database/database.service.js';

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest();
const token = () => randomBytes(32).toString('base64url');
interface Challenge extends RowDataPacket { nonce_hash: Buffer }
interface User extends RowDataPacket { id: number; display_name: string; profile_image_url: string | null; status: string }

@Injectable()
export class AuthService {
  private readonly google = new OAuth2Client();
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}
  enabled(): boolean { return Boolean(this.config.googleClientId && this.config.authOrigins?.length); }
  private requireEnabled(): void { if (!this.enabled()) throw new ServiceUnavailableException('User sign-in is not configured'); }
  async challenge(): Promise<{challenge: string; nonce: string}> {
    this.requireEnabled();
    const challenge=token(), nonce=token();
    await this.db.pool.execute('DELETE FROM auth_challenges WHERE expires_at<=UTC_TIMESTAMP(3)');
    await this.db.pool.execute('INSERT INTO auth_challenges (challenge_hash,nonce_hash,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE))',[hash(challenge),hash(nonce)]);
    return {challenge,nonce};
  }
  async login(credential: string, challenge: string): Promise<{session: string; user: {id: number; displayName: string; profileImageUrl: string | null}}> {
    this.requireEnabled();
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || credential.length > 8192 || credential.length < 1) throw new UnauthorizedException('Invalid sign-in');
    let payload;
    try { payload=(await this.google.verifyIdToken({idToken:credential,audience:this.config.googleClientId})).getPayload(); }
    catch { throw new UnauthorizedException('Invalid sign-in'); }
    if (!payload || typeof payload.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(payload.sub) || typeof payload.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.nonce)) throw new UnauthorizedException('Invalid sign-in');
    const connection=await this.db.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows]=await connection.execute<Challenge[]>('SELECT nonce_hash FROM auth_challenges WHERE challenge_hash=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE',[hash(challenge)]);
      if (!rows[0] || !timingSafeEqual(rows[0].nonce_hash,hash(payload.nonce))) throw new UnauthorizedException('Invalid or expired sign-in');
      await connection.execute('DELETE FROM auth_challenges WHERE challenge_hash=?',[hash(challenge)]);
      let [users]=await connection.execute<User[]>("SELECT u.id,u.display_name,u.profile_image_url,u.status FROM users u JOIN user_identities i ON i.user_id=u.id WHERE i.provider='google' AND i.provider_subject=? FOR UPDATE",[payload.sub]);
      if (!users[0]) {
        const displayName=typeof payload.name==='string' ? Array.from(payload.name.trim()).slice(0,191).join('') || 'Dracula user' : 'Dracula user';
        let image: string | null = null;
        if (typeof payload.picture==='string' && payload.picture.length<=2048) {
          try { const url=new URL(payload.picture); if (url.protocol==='https:' && !url.username && !url.password && (url.hostname==='googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'))) image=url.href; } catch { /* ignore invalid images */ }
        }
        const [result]=await connection.execute<ResultSetHeader>('INSERT INTO users (display_name,profile_image_url) VALUES (?,?)',[displayName,image]);
        await connection.execute("INSERT INTO user_identities (user_id,provider,provider_subject) VALUES (?,'google',?)",[result.insertId,payload.sub]);
        [users]=await connection.execute<User[]>('SELECT id,display_name,profile_image_url,status FROM users WHERE id=?',[result.insertId]);
      }
      const user=users[0]; if (!user || user.status!=='active') throw new UnauthorizedException('Account unavailable');
      const session=token();
      await connection.execute('INSERT INTO user_sessions (user_id,session_hash,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 DAY))',[user.id,hash(session)]);
      await connection.commit();
      return {session,user:{id:user.id,displayName:user.display_name,profileImageUrl:user.profile_image_url}};
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }
  async current(session: string): Promise<{id: number; displayName: string; profileImageUrl: string | null}> {
    this.requireEnabled();
    if (!/^[A-Za-z0-9_-]{43}$/.test(session)) throw new UnauthorizedException();
    const [users]=await this.db.pool.execute<User[]>("SELECT u.id,u.display_name,u.profile_image_url,u.status FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.session_hash=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3) AND u.status='active'",[hash(session)]);
    if (!users[0]) throw new UnauthorizedException();
    return {id:users[0].id,displayName:users[0].display_name,profileImageUrl:users[0].profile_image_url};
  }
  async update(session: string, displayName: string) {
    const user=await this.current(session);
    await this.db.pool.execute('UPDATE users SET display_name=? WHERE id=?',[displayName,user.id]);
    return {...user,displayName};
  }
  async logout(session: string): Promise<void> {
    this.requireEnabled();
    if (/^[A-Za-z0-9_-]{43}$/.test(session)) await this.db.pool.execute('UPDATE user_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE session_hash=? AND revoked_at IS NULL',[hash(session)]);
  }
}
