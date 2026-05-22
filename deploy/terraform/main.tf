provider "aws" {
  region = var.aws_region
}

# 1. VPC & Networking Infrastructure
resource "aws_vpc" "iicpc_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = {
    Name = "iicpc-vpc"
  }
}

resource "aws_subnet" "public_subnet_a" {
  vpc_id            = aws_vpc.iicpc_vpc.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "${var.aws_region}a"
  map_public_ip_on_launch = true
}

resource "aws_subnet" "public_subnet_b" {
  vpc_id            = aws_vpc.iicpc_vpc.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "${var.aws_region}b"
  map_public_ip_on_launch = true
}

resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.iicpc_vpc.id
}

resource "aws_route_table" "public_rt" {
  vpc_id = aws_vpc.iicpc_vpc.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.gw.id
  }
}

resource "aws_route_table_association" "a" {
  subnet_id      = aws_subnet.public_subnet_a.id
  route_table_id = aws_route_table.public_rt.id
}

resource "aws_route_table_association" "b" {
  subnet_id      = aws_subnet.public_subnet_b.id
  route_table_id = aws_route_table.public_rt.id
}

# 2. AWS ECS Fargate Cluster (For Sandboxing & Orchestrator API)
resource "aws_ecs_cluster" "iicpc_cluster" {
  name = "iicpc-systems-cluster"
}

resource "aws_ecs_task_definition" "backend_task" {
  family                   = "iicpc-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024" # 1 vCPU
  memory                   = "2048" # 2 GB RAM

  container_definitions = jsonencode([{
    name      = "orchestrator"
    image     = "${var.ecr_backend_url}:latest"
    essential = true
    portMappings = [{
      containerPort = 5000
      hostPort      = 5000
    }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "DATABASE_URL", value = "postgresql://${var.db_user}:${var.db_password}@${aws_db_instance.postgres.endpoint}/${var.db_name}" }
    ]
  }])
}

# 3. Amazon RDS PostgreSQL Instance (Telemetry Time-Series Store)
resource "aws_db_subnet_group" "db_subnets" {
  name       = "iicpc-db-subnets"
  subnet_ids = [aws_subnet.public_subnet_a.id, aws_subnet.public_subnet_b.id]
}

resource "aws_db_instance" "postgres" {
  identifier             = "iicpc-telemetry-db"
  allocated_storage      = 20
  engine                 = "postgres"
  engine_version         = "14"
  instance_class         = "db.t4g.medium"
  db_name                = var.db_name
  username               = var.db_user
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.db_subnets.name
  skip_final_snapshot    = true
}

# 4. AWS ElastiCache Redis Cluster (High-Performance In-Memory Queue)
resource "aws_elasticache_subnet_group" "redis_subnets" {
  name       = "iicpc-redis-subnets"
  subnet_ids = [aws_subnet.public_subnet_a.id, aws_subnet.public_subnet_b.id]
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "iicpc-metrics-queue"
  engine               = "redis"
  node_type            = "cache.t4g.small"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis6.x"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.redis_subnets.name
}

# 5. AWS EKS Kubernetes Cluster (For Scalable Distributed Bot Fleet Load Generator)
resource "aws_iam_role" "eks_cluster_role" {
  name = "iicpc-eks-cluster-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "eks.amazonaws.com" }
    }]
  })
}

resource "aws_eks_cluster" "eks" {
  name     = "iicpc-bot-fleet-cluster"
  role_arn = aws_iam_role.eks_cluster_role.arn

  vpc_config {
    subnet_ids = [aws_subnet.public_subnet_a.id, aws_subnet.public_subnet_b.id]
  }
}
