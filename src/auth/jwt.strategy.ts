import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'CHANGE_ME',
    });
  }

  async validate(payload: JwtPayload) {
    // attach user info (including roles) to request.user
    return {
      userId: payload.sub,
      username: payload.username,
      roles: payload.roles,
    };
  }
}
