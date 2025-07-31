import React, { useState } from 'react';
import { Container, Row, Col, Card, Button, Alert } from 'react-bootstrap';
import { signInWithGitHub } from '../firebase';
import { Github, Server, Shield, Globe } from 'react-bootstrap-icons';

const LandingPage = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGitHubLogin = async () => {
    try {
      setError('');
      setLoading(true);
      await signInWithGitHub();
    } catch (error) {
      console.error('Authentication error:', error);
      setError('Failed to sign in with GitHub. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-vh-100 bg-light">
      {/* Header */}
      <Container fluid className="bg-primary text-white py-5">
        <Container>
          <Row className="align-items-center">
            <Col md={8}>
              <h1 className="display-4 fw-bold mb-3">
                <Globe className="me-3" />
                Cloudflare Domains Manager
              </h1>
              <p className="lead mb-0">
                Securely manage your Cloudflare domains, DNS records, and more with our comprehensive management platform.
              </p>
            </Col>
            <Col md={4} className="text-center">
              <Shield size={120} className="text-white-50" />
            </Col>
          </Row>
        </Container>
      </Container>

      {/* Main Content */}
      <Container className="py-5">
        <Row className="justify-content-center">
          <Col lg={8}>
            {/* Authentication Card */}
            <Card className="shadow-lg border-0 mb-5">
              <Card.Body className="p-5 text-center">
                <Github size={60} className="text-primary mb-4" />
                <h2 className="mb-3">Secure Access Required</h2>
                <p className="text-muted mb-4">
                  Sign in with your GitHub account to access the Cloudflare Domains Manager.
                  Your authentication is secured through Firebase.
                </p>
                
                {error && (
                  <Alert variant="danger" className="mb-4">
                    {error}
                  </Alert>
                )}

                <Button
                  variant="dark"
                  size="lg"
                  onClick={handleGitHubLogin}
                  disabled={loading}
                  className="px-5"
                >
                  {loading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      <Github className="me-2" />
                      Sign in with GitHub
                    </>
                  )}
                </Button>
              </Card.Body>
            </Card>

            {/* Features Section */}
            <Row className="g-4">
              <Col md={4}>
                <Card className="h-100 border-0 shadow-sm">
                  <Card.Body className="text-center p-4">
                    <Globe size={40} className="text-primary mb-3" />
                    <h5>Domain Management</h5>
                    <p className="text-muted small">
                      View and organize all your Cloudflare domains in one place
                    </p>
                  </Card.Body>
                </Card>
              </Col>
              <Col md={4}>
                <Card className="h-100 border-0 shadow-sm">
                  <Card.Body className="text-center p-4">
                    <Server size={40} className="text-success mb-3" />
                    <h5>DNS Records</h5>
                    <p className="text-muted small">
                      Browse and analyze DNS records for each domain
                    </p>
                  </Card.Body>
                </Card>
              </Col>
              <Col md={4}>
                <Card className="h-100 border-0 shadow-sm">
                  <Card.Body className="text-center p-4">
                    <Shield size={40} className="text-warning mb-3" />
                    <h5>Secure Access</h5>
                    <p className="text-muted small">
                      Protected by Firebase authentication with GitHub
                    </p>
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          </Col>
        </Row>
      </Container>

      {/* Footer */}
      <Container fluid className="bg-dark text-white py-4 mt-5">
        <Container>
          <Row>
            <Col md={6}>
              <p className="mb-0">&copy; 2024 Cloudflare Domains Manager</p>
            </Col>
            <Col md={6} className="text-md-end">
              <p className="mb-0">Powered by React, Firebase, and Cloudflare API</p>
            </Col>
          </Row>
        </Container>
      </Container>
    </div>
  );
};

export default LandingPage;