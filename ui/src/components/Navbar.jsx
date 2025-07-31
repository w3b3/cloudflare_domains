import React from 'react';
import { Navbar as BootstrapNavbar, Container, Nav, NavDropdown, Button } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { logOut } from '../firebase';
import { PersonCircle, BoxArrowRight } from 'react-bootstrap-icons';

const Navbar = () => {
  const { user } = useAuth();

  const handleLogout = async () => {
    try {
      await logOut();
    } catch (error) {
      console.error('Failed to log out:', error);
    }
  };

  if (!user) return null;

  return (
    <BootstrapNavbar bg="dark" variant="dark" expand="lg">
      <Container>
        <BootstrapNavbar.Brand as={Link} to="/">
          Cloudflare Domains Manager
        </BootstrapNavbar.Brand>
        <BootstrapNavbar.Toggle aria-controls="basic-navbar-nav" />
        <BootstrapNavbar.Collapse id="basic-navbar-nav">
          <Nav className="me-auto">
            <Nav.Link as={Link} to="/">Domains</Nav.Link>
          </Nav>
          <Nav className="ms-auto">
            <NavDropdown 
              title={
                <span>
                  <PersonCircle className="me-2" />
                  {user.displayName || user.email}
                </span>
              } 
              id="user-dropdown"
              align="end"
            >
              <NavDropdown.Item disabled>
                Signed in as {user.displayName || user.email}
              </NavDropdown.Item>
              <NavDropdown.Divider />
              <NavDropdown.Item onClick={handleLogout}>
                <BoxArrowRight className="me-2" />
                Sign out
              </NavDropdown.Item>
            </NavDropdown>
          </Nav>
        </BootstrapNavbar.Collapse>
      </Container>
    </BootstrapNavbar>
  );
};

export default Navbar; 