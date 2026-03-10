// // src/api/axios.js
// import axios from 'axios';
// import { useNavigate } from 'react-router-dom';

// const axiosInstance = axios.create({
//   baseURL: process.env.REACT_APP_API_BASE_URL, // Your API base URL
// });
// const navigate = useNavigate();

// // Request interceptor to attach the token
// axiosInstance.interceptors.request.use(
//   (config) => {
//     const token = localStorage.getItem('authToken');
//     if (token) {
//       config.headers.Authorization = `Bearer ${token}`;
//     }
//     return config;
//   },
//   (error) => {
//     return Promise.reject(error);
//   }
// );

// // Response interceptor (optional: handle token expiration)
// axiosInstance.interceptors.response.use(
//   (response) => response,
//   (error) => {
//     if (error.response?.status === 401) {
//       localStorage.removeItem('authToken');
//       navigate('/login'); // Redirect to login if token is invalid
//     }
//     return Promise.reject(error);
//   }
// );

// export default axiosInstance;


















// src/hooks/useAuthAxios.js
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function useAuthAxios() {
  const navigate = useNavigate();

  const axiosInstance = useMemo(
    () =>
      axios.create({
        baseURL: process.env.REACT_APP_API_BASE_URL,
      }),
    []
  );

  useEffect(() => {
    const requestInterceptorId = axiosInstance.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('authToken');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    const responseInterceptorId = axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('authToken');
          navigate('/login');
        }
        return Promise.reject(error);
      }
    );

    return () => {
      axiosInstance.interceptors.request.eject(requestInterceptorId);
      axiosInstance.interceptors.response.eject(responseInterceptorId);
    };
  }, [axiosInstance, navigate]);

  return axiosInstance;
}
