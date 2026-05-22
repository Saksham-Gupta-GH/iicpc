variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "Target deployment region in AWS"
}

variable "ecr_backend_url" {
  type        = string
  default     = "123456789012.dkr.ecr.us-east-1.amazonaws.com/iicpc-backend"
  description = "AWS Elastic Container Registry repository URL for backend"
}

variable "db_name" {
  type        = string
  default     = "iicpc_telemetry"
  description = "Database name for telemetry data"
}

variable "db_user" {
  type        = string
  default     = "iicpc_admin"
  description = "Database root username"
}

variable "db_password" {
  type        = string
  default     = "SecurePassword123!"
  sensitive   = true
  description = "Database root password"
}
