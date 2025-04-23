import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Row, Col, Card, Tabs, Tab, Table, Form, Button, Alert, Spinner,
  Badge, ListGroup
} from 'react-bootstrap';
import { 
  getDnsRecords, getZoneMetadata, updateZoneMetadata, getZoneTasks, 
  createTask, updateTask, deleteTask, takeScreenshot 
} from '../services/api';

const truncateContent = (content, maxLength = 25) => {
  return content.length > maxLength ? content.substring(0, maxLength) + '...' : content;
};

const DomainDetail = () => {
  const { domainName } = useParams();
  const navigate = useNavigate();
  
  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [records, setRecords] = useState([]);
  const [metadata, setMetadata] = useState({ tag: '', notes: '' });
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState('');
  const [saving, setSaving] = useState(false);
  const [screenShotLoading, setScreenshotLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('records');
  
  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch records
        const recordsResponse = await getDnsRecords(domainName);
        if (recordsResponse.success) {
          setRecords(recordsResponse.data);
        }
        
        // Fetch metadata
        const metadataResponse = await getZoneMetadata(domainName);
        if (metadataResponse.success) {
          setMetadata(metadataResponse.data);
        }
        
        // Fetch tasks
        const tasksResponse = await getZoneTasks(domainName);
        if (tasksResponse.success) {
          setTasks(tasksResponse.data);
        }
        
      } catch (err) {
        setError(err.message || 'Failed to fetch domain data');
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [domainName]);
  
  // Handlers
  const handleSaveMetadata = async () => {
    try {
      setSaving(true);
      const response = await updateZoneMetadata(domainName, {
        tag: metadata.tag,
        notes: metadata.notes
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to save metadata');
      }
      
    } catch (err) {
      setError(err.message || 'Failed to save metadata');
    } finally {
      setSaving(false);
    }
  };
  
  const handleAddTask = async () => {
    if (!newTask.trim()) return;
    
    try {
      setSaving(true);
      const response = await createTask(domainName, { task_description: newTask });
      
      if (response.success) {
        setTasks([response.data, ...tasks]);
        setNewTask('');
      } else {
        throw new Error(response.error || 'Failed to add task');
      }
    } catch (err) {
      setError(err.message || 'Failed to add task');
    } finally {
      setSaving(false);
    }
  };
  
  const handleTaskStatusChange = async (taskId, isCompleted) => {
    try {
      const response = await updateTask(domainName, taskId, { is_completed: isCompleted });
      
      if (response.success) {
        // Update task in state
        setTasks(tasks.map(task => 
          task.id === taskId ? { ...task, is_completed: isCompleted ? 1 : 0 } : task
        ));
      }
    } catch (err) {
      setError(err.message || 'Failed to update task');
    }
  };
  
  const handleDeleteTask = async (taskId) => {
    try {
      const response = await deleteTask(domainName, taskId);
      
      if (response.success) {
        // Remove task from state
        setTasks(tasks.filter(task => task.id !== taskId));
      }
    } catch (err) {
      setError(err.message || 'Failed to delete task');
    }
  };
  
  const handleTakeScreenshot = async () => {
    try {
      setScreenshotLoading(true);
      const response = await takeScreenshot(domainName);
      
      if (response.success) {
        // Force reload metadata to get new screenshot path
        const metadataResponse = await getZoneMetadata(domainName);
        if (metadataResponse.success) {
          setMetadata(metadataResponse.data);
        }
      } else {
        throw new Error(response.error || 'Failed to take screenshot');
      }
    } catch (err) {
      setError(err.message || 'Failed to take screenshot');
    } finally {
      setScreenshotLoading(false);
    }
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
  
  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h1>{domainName}</h1>
        <Button variant="outline-secondary" onClick={() => navigate('/')}>
          Back to Domains
        </Button>
      </div>
      
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      
      <Row>
        <Col lg={8}>
          <Card className="mb-4">
            <Card.Header>
              <Tabs
                activeKey={activeTab}
                onSelect={(k) => setActiveTab(k)}
                className="card-header-tabs"
              >
                <Tab eventKey="records" title="DNS Records" />
                <Tab eventKey="tasks" title="Tasks" />
              </Tabs>
            </Card.Header>
            <Card.Body>
              {activeTab === 'records' && (
                <Table responsive striped hover>
                  <thead>
                    <tr>
                      <th style={{width: '25%'}}>Name</th>
                      <th style={{width: '10%'}}>Type</th>
                      <th style={{width: '50%'}}>Target</th>
                      <th style={{width: '15%'}}>Proxied</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record, index) => {
                      // Check if this is a root domain record
                      const isRoot = record.name === domainName;
                      
                      // Extract subdomain or use root marker
                      let displayName = isRoot ? (
                        <strong>{domainName}</strong>
                      ) : record.name.replace(`.${domainName}`, '');
                      
                      return (
                        <tr key={index} className={isRoot ? 'table-primary' : ''}>
                          <td>
                            <a href={`http://${record.name}`} target="_blank" rel="noopener noreferrer">
                              {displayName}
                            </a>
                          </td>
                          <td>{record.type}</td>
                          <td>
                            <small className="text-muted">
                              {truncateContent(record.content)}
                            </small>
                          </td>
                          <td>
                            {record.proxied ? (
                              <Badge bg="success">Yes</Badge>
                            ) : (
                              <Badge bg="secondary">No</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
              
              {activeTab === 'tasks' && (
                <>
                  <Form className="mb-3" onSubmit={(e) => {
                    e.preventDefault();
                    handleAddTask();
                  }}>
                    <Form.Group as={Row} className="mb-3">
                      <Col sm={9}>
                        <Form.Control
                          type="text"
                          placeholder="Add a new task..."
                          value={newTask}
                          onChange={(e) => setNewTask(e.target.value)}
                          disabled={saving}
                        />
                      </Col>
                      <Col sm={3}>
                        <Button 
                          variant="primary" 
                          type="submit" 
                          disabled={!newTask.trim() || saving}
                          className="w-100"
                        >
                          {saving ? 'Adding...' : 'Add Task'}
                        </Button>
                      </Col>
                    </Form.Group>
                  </Form>
                  
                  <ListGroup>
                    {tasks.length === 0 ? (
                      <p className="text-muted">No tasks yet. Add your first task above.</p>
                    ) : (
                      tasks.map(task => (
                        <ListGroup.Item 
                          key={task.id} 
                          className="d-flex justify-content-between align-items-center"
                        >
                          <div className="d-flex align-items-center">
                            <Form.Check
                              type="checkbox"
                              checked={task.is_completed === 1}
                              onChange={(e) => handleTaskStatusChange(task.id, e.target.checked)}
                              label=""
                              className="me-2"
                            />
                            <span className={task.is_completed === 1 ? 'text-decoration-line-through' : ''}>
                              {task.task_description}
                            </span>
                          </div>
                          <Button 
                            variant="outline-danger" 
                            size="sm"
                            onClick={() => handleDeleteTask(task.id)}
                          >
                            Delete
                          </Button>
                        </ListGroup.Item>
                      ))
                    )}
                  </ListGroup>
                </>
              )}
            </Card.Body>
          </Card>
        </Col>
        
        <Col lg={4}>
          <Card className="mb-4">
            <Card.Header>
              <h5>Domain Information</h5>
            </Card.Header>
            <Card.Body>
              <Form>
                <Form.Group className="mb-3">
                  <Form.Label>Tag (Purpose)</Form.Label>
                  <Form.Control
                    type="text"
                    value={metadata.tag || ''}
                    onChange={(e) => setMetadata({ ...metadata, tag: e.target.value })}
                    placeholder="e.g., Blog, Client Project, Personal"
                  />
                  <Form.Text className="text-muted">
                    What is this domain used for?
                  </Form.Text>
                </Form.Group>
                
                <Form.Group className="mb-3">
                  <Form.Label>Notes</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={metadata.notes || ''}
                    onChange={(e) => setMetadata({ ...metadata, notes: e.target.value })}
                    placeholder="Add notes about this domain..."
                  />
                </Form.Group>
                
                <Button 
                  variant="primary" 
                  onClick={handleSaveMetadata}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Information'}
                </Button>
              </Form>
            </Card.Body>
          </Card>
          
          <Card>
            <Card.Header>
              <h5>Screenshot</h5>
            </Card.Header>
            <Card.Body>
              {screenShotLoading ? (
                <div className="text-center p-5">
                  <Spinner animation="border" />
                  <p className="mt-2">Taking screenshot...</p>
                </div>
              ) : metadata.screenshot_path && metadata.screenshot_path.trim() !== '' ? (
                <div className="screenshot-container mb-3">
                  <a 
                    href={`/screenshots/${metadata.screenshot_path}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                  >
                    <img 
                      src={`/screenshots/${metadata.screenshot_path}`}
                      alt={`Screenshot of ${domainName}`}
                      className="img-fluid rounded"
                    />
                    <small className="d-block text-muted mt-1 text-end">
                      Click to view full size
                    </small>
                  </a>
                </div>
              ) : (
                <div className="placeholder mb-3">
                  <p>No screenshot available</p>
                </div>
              )}
              
              <Button 
                variant="secondary" 
                onClick={handleTakeScreenshot}
                disabled={screenShotLoading}
                className="w-100"
              >
                {screenShotLoading ? 'Processing...' : 'Take Screenshot'}
              </Button>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </>
  );
};

export default DomainDetail; 