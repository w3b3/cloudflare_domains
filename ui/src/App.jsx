import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Container } from 'react-bootstrap';
import DomainList from './components/DomainList';
import DomainDetail from './components/DomainDetail';
import Navbar from './components/Navbar';

function App() {
  return (
    <>
      <Navbar />
      <Container className="py-4">
        <Routes>
          <Route path="/" element={<DomainList />} />
          <Route path="/domain/:domainName" element={<DomainDetail />} />
        </Routes>
      </Container>
    </>
  );
}

export default App; 