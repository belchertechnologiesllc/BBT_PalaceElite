import { useAuth } from '../auth/AuthProvider';

export function ProfilePage() {
  const { user } = useAuth();

  const displayName =
    typeof user?.user_metadata?.full_name === 'string'
      ? user.user_metadata.full_name
      : user?.email?.split('@')[0] ?? 'Palace Elite user';

  const createdAt = user?.created_at
    ? new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(user.created_at))
    : 'Unavailable';

  const lastSignIn = user?.last_sign_in_at
    ? new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(user.last_sign_in_at))
    : 'Unavailable';

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Account</p>
          <h2>Profile</h2>
          <p className="subtitle">
            Your authenticated Palace Elite account.
          </p>
        </div>
      </section>

      <section className="profile-grid">
        <article className="panel profile-card">
          <div className="profile-avatar" aria-hidden="true">
            {displayName.charAt(0).toUpperCase()}
          </div>

          <div>
            <p className="eyebrow">Signed-in user</p>
            <h3>{displayName}</h3>
            <p>{user?.email ?? 'No email available'}</p>
          </div>
        </article>

        <article className="panel account-details">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Supabase Authentication</p>
              <h3>Account details</h3>
            </div>
          </div>

          <dl className="details-list">
            <div>
              <dt>Email</dt>
              <dd>{user?.email ?? 'Unavailable'}</dd>
            </div>

            <div>
              <dt>User ID</dt>
              <dd className="monospace">{user?.id ?? 'Unavailable'}</dd>
            </div>

            <div>
              <dt>Account created</dt>
              <dd>{createdAt}</dd>
            </div>

            <div>
              <dt>Last sign-in</dt>
              <dd>{lastSignIn}</dd>
            </div>

            <div>
              <dt>Email confirmed</dt>
              <dd>{user?.email_confirmed_at ? 'Yes' : 'No'}</dd>
            </div>
          </dl>
        </article>
      </section>
    </>
  );
}
