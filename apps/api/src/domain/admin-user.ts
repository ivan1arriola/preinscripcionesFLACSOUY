export interface AdminUser {
  id: string;
  googleSubject: string;
  email: string;
  name: string;
  pictureUrl?: string;
  role: 'admin';
  createdAt: Date;
  lastLoginAt?: Date;
}
