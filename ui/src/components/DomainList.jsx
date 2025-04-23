import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Spinner, Alert } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { getZones } from '../services/api';

const DomainList = () => {
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchDomains = async () => {
      try {
        setLoading(true);
        const { success, data } = await getZones();
        if (success) {
          setDomains(data);
        } else {
          setError('Failed to fetch domains');
        }
      } catch (err) {
        setError(err.message || 'Failed to fetch domains');
      } finally {
        setLoading(false);
      }
    };

    fetchDomains();
  }, []);

  const handleDomainClick = (domainName) => {
    navigate(`/domain/${domainName}`);
  };

  if (loading) {
    return (
      <div className="d-flex justify-content-center my-5">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="danger">
        <Alert.Heading>Error</Alert.Heading>
        <p>{error}</p>
      </Alert>
    );
  }

  return (
    <>
      <h1 className="mb-4">Cloudflare Domains</h1>
      
      <Row xs={1} md={2} lg={3} xl={4} className="g-4">
        {domains.map((domain) => (
          <Col key={domain.id}>
            <Card 
              className="h-100 clickable"
              onClick={() => handleDomainClick(domain.name)}
            >
              <Card.Body>
                <Card.Title>{domain.name}</Card.Title>
                <Card.Text>
                  <small className="text-muted">
                    Status: {domain.status}
                  </small>
                </Card.Text>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
      
      {domains.length === 0 && !loading && (
        <Alert variant="info">
          No domains found. Make sure your Cloudflare API token is correctly configured.
        </Alert>
      )}
    </>
  );
};

export default DomainList; 