import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";

const withAuth = (WrappedComponent, allowedRoles) => {
  return function ProtectedComponent(props) {
    const [userRole, setUserRole] = useState(null);
    const [isClient, setIsClient] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
      setIsClient(true);
    }, []);

    useEffect(() => {
      if (!isClient) return;

      const token = localStorage.getItem("authToken");

      if (!token) {
        navigate("/login");
        return;
      }

      try {
        const decoded = jwtDecode(token);
        setUserRole(decoded.role);


        if (!allowedRoles.includes(decoded.role)) {
          navigate("/unauthorized");
        }
      } catch (error) {
        localStorage.removeItem("authToken");
        navigate("/login");
      }
    }, [isClient, navigate, allowedRoles]);

    if (!userRole) {
      return (
        <div className="p-6 bg-gray-100 min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
        </div>
      );
    }

    return <WrappedComponent {...props} />;
  };
};

export default withAuth;
