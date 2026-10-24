import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Every route needs an admin session (see AdminAuthGuard) unless it, or its controller, is marked
// with this — i.e. what the public Alerts page needs.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
