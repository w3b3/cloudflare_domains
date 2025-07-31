import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import LandingPage from './LandingPage';

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ height: '100vh' }}>
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  return children;
};

export default ProtectedRoute;