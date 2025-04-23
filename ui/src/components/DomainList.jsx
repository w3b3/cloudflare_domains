import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Spinner, Alert, Badge, ButtonGroup, Button, Collapse } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { getZones, getAllData } from '../services/api';

const DomainList = () => {
  const [domains, setDomains] = useState([]);
  const [domainsData, setDomainsData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTag, setActiveTag] = useState(null);
  const [availableTags, setAvailableTags] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchDomains = async () => {
      try {
        setLoading(true);
        
        // Get all domain data including screenshots
        const { success, data } = await getAllData();
        
        if (success) {
          // Extract just the domains for the domain list
          const zonesArray = Object.values(data).map(item => item.zone);
          setDomains(zonesArray);
          
          // Store the full data including screenshots for the cards
          setDomainsData(data);
          
          // Extract all unique tags with counts
          const tagsMap = {};
          Object.values(data).forEach(item => {
            const tag = item.metadata?.tag;
            if (tag && tag.trim() !== '') {
              tagsMap[tag] = (tagsMap[tag] || 0) + 1;
            }
          });
          
          // Convert to array of {name, count} objects and sort by name
          const tagsArray = Object.entries(tagsMap)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => a.name.localeCompare(b.name));
            
          setAvailableTags(tagsArray);
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
  
  const handleTagFilter = (tagName) => {
    setActiveTag(tagName === activeTag ? null : tagName);
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
  
  // Filter domains by tag if a tag is selected
  const filteredDomains = activeTag
    ? domains.filter(domain => {
        const metadata = domainsData[domain.name]?.metadata || {};
        return metadata.tag === activeTag;
      })
    : domains;

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1>Cloudflare Domains</h1>
        
        {availableTags.length > 0 && (
          <Button 
            variant={activeTag ? "primary" : "light"}
            size="sm" 
            onClick={() => setShowFilters(!showFilters)}
            className="filter-toggle-btn"
          >
            {activeTag ? (
              <>
                <i className="bi bi-funnel-fill me-1"></i> 
                Filtered by: <span className="ms-1 badge bg-light text-dark">{activeTag}</span>
              </>
            ) : (
              <>
                <i className="bi bi-funnel me-1"></i> Filter
              </>
            )}
          </Button>
        )}
      </div>
      
      {/* Tag filtering - collapsed by default */}
      {availableTags.length > 0 && (
        <Collapse in={showFilters}>
          <div className="tag-filter-container mb-4">
            <h5 className="tag-filter-title">Filter by tag:</h5>
            <div className="tag-filter-buttons">
              {availableTags.map((tag) => (
                <Button 
                  key={tag.name}
                  variant={activeTag === tag.name ? "primary" : "outline-primary"}
                  size="sm"
                  onClick={() => {
                    handleTagFilter(tag.name);
                    if (tag.name !== activeTag) {
                      setShowFilters(false);
                    }
                  }}
                  className={`tag-button ${activeTag === tag.name ? 'active-tag' : ''}`}
                >
                  {tag.name} <span className="ms-1 badge bg-secondary">{tag.count}</span>
                  {activeTag === tag.name && (
                    <span className="ms-2">&times;</span>
                  )}
                </Button>
              ))}
              {activeTag && (
                <Button 
                  variant="outline-secondary" 
                  size="sm"
                  onClick={() => {
                    setActiveTag(null);
                    setShowFilters(false);
                  }}
                  className="tag-button"
                >
                  Clear filter
                </Button>
              )}
            </div>
          </div>
        </Collapse>
      )}
      
      {domains.length > 0 && activeTag && (
        <div className="alert alert-light border mb-4">
          <div className="d-flex justify-content-between align-items-center">
            <span>
              <i className="bi bi-filter me-2"></i> 
              Showing domains tagged as <strong>{activeTag}</strong>
            </span>
            <Button 
              variant="link" 
              className="p-0 text-decoration-none" 
              onClick={() => setActiveTag(null)}
            >
              <i className="bi bi-x-lg"></i>
            </Button>
          </div>
        </div>
      )}
      
      <Row xs={1} md={2} lg={3} xl={4} className="g-4">
        {filteredDomains.map((domain) => {
          // Get domain data including metadata with screenshot
          const domainData = domainsData[domain.name] || {};
          const metadata = domainData.metadata || {};
          const hasScreenshot = metadata.screenshot_path && metadata.screenshot_path.trim() !== '';
          const tag = metadata.tag || '';
          
          // Card style with screenshot as background if available
          const cardStyle = hasScreenshot ? {
            backgroundImage: `url('/screenshots/${metadata.screenshot_path}')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            height: '200px',
            position: 'relative'
          } : {
            height: '200px',
            position: 'relative'
          };
          
          return (
            <Col key={domain.id}>
              <Card 
                className="h-100 clickable"
                style={cardStyle}
                onClick={() => handleDomainClick(domain.name)}
              >
                {/* Dark overlay for better text visibility on image */}
                {hasScreenshot && (
                  <div 
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      borderRadius: 'inherit'
                    }}
                  />
                )}
                
                <Card.Body style={{ position: 'relative', zIndex: 1 }}>
                  <Card.Title className={hasScreenshot ? 'text-white' : ''}>
                    {domain.name}
                  </Card.Title>
                  <Card.Text>
                    <small className={hasScreenshot ? 'text-white' : 'text-muted'}>
                      Status: {domain.status}
                    </small>
                  </Card.Text>
                  
                  {/* Display tag if exists */}
                  {tag && (
                    <Badge 
                      bg={activeTag === tag ? "primary" : "info"} 
                      className="mt-2 card-tag"
                    >
                      {tag}
                    </Badge>
                  )}
                </Card.Body>
              </Card>
            </Col>
          );
        })}
      </Row>
      
      {domains.length === 0 && !loading && (
        <Alert variant="info">
          No domains found. Make sure your Cloudflare API token is correctly configured.
        </Alert>
      )}
      
      {domains.length > 0 && filteredDomains.length === 0 && (
        <Alert variant="info">
          No domains match the selected tag filter "{activeTag}".
          <Button 
            variant="link" 
            onClick={() => setActiveTag(null)}
            className="p-0 ms-2"
          >
            Clear filter
          </Button>
        </Alert>
      )}
    </>
  );
};

export default DomainList; 