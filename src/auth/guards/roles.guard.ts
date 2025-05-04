import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../roles.decorator';


@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) { }

    canActivate(ctx: ExecutionContext): boolean {
        const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
            ctx.getHandler(),
            ctx.getClass(),
        ]);
        if (!required) return true;

        const { user } = ctx.switchToHttp().getRequest();
        if (!user || !user.roles) return false;

        const hasRole = user.roles.some((r: string) => required.includes(r));
        if (!hasRole) throw new ForbiddenException('Insufficient role');
        return true;
    }
}
