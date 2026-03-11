import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

jest.mock('./components/SignIn', () => function MockSignIn() {
  return <div>SignIn Page</div>;
});

jest.mock('./components/AdminDashboard', () => function MockAdmin() {
  return <div>Admin Dashboard</div>;
});

jest.mock('./components/ResetPassword', () => function MockResetPassword() {
  return <div>Reset Password</div>;
});

jest.mock('./components/ChangePassword', () => function MockChangePassword() {
  return <div>Change Password</div>;
});

jest.mock('./ChatPage', () => function MockChatPage() {
  return <div>Chat Page</div>;
});

jest.mock('./VideoProcessingPage', () => function MockVideoProcessingPage() {
  return <div>Video Processing Page</div>;
});

describe('App routing', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('redirects / to /login', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('SignIn Page')).toBeInTheDocument();
    });
  });

  test('redirects /processing to /analysis', async () => {
    window.history.pushState({}, '', '/processing');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Video Processing Page')).toBeInTheDocument();
    });
  });

  test('protects /admin and redirects to /login when no token', async () => {
    window.history.pushState({}, '', '/admin');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('SignIn Page')).toBeInTheDocument();
    });
  });
});
