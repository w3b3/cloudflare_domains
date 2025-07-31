import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Container } from 'react-bootstrap';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import DomainList from './components/DomainList';
import DomainDetail from './components/DomainDetail';
import Navbar from './components/Navbar';

function App() {
  return (
    <AuthProvider>
      <ProtectedRoute>
        <Navbar />
        <Container className="py-4">
          <Routes>
            <Route path="/" element={<DomainList />} />
            <Route path="/domain/:domainName" element={<DomainDetail />} />
          </Routes>
        </Container>
      </ProtectedRoute>
    </AuthProvider>
  );
}

export default App; 